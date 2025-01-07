// Simple HTTP / HTTPS Web Server
// A component for the pixl-server daemon framework.
// Copyright (c) 2015 - 2025 Joseph Huckaby
// Released under the MIT License

const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const https = require('https');
const tls = require('tls');
const async = require('async');
const Formidable = require('formidable');
const Querystring = require('querystring');
const ErrNo = require('errno');
const StreamMeter = require("stream-meter");
const Class = require("class-plus");
const Component = require("pixl-server/component");
const Perf = require('pixl-perf');
const ACL = require('pixl-acl');

module.exports = class HTTP2 {
	
	setupHTTPS() {
		// load certs and setup monitoring
		// this is called only once, even if we have multiple ssl listeners
		this.reloadCert();
		
		// monitor files for changes
		this.server.on('tick', this.monitorCert.bind(this));
	}
	
	reloadCert() {
		// reload certs and secure context
		var self = this;
		var mgr = {
			files: {
				cert: this.config.get('https_cert_file'),
				key: this.config.get('https_key_file')
			},
			opts: {
				cert: fs.readFileSync( this.config.get('https_cert_file') ),
				key: fs.readFileSync( this.config.get('https_key_file') )
			},
			mods: {
				cert: fs.statSync(this.config.get('https_cert_file')).mtimeMs,
				key: fs.statSync(this.config.get('https_key_file')).mtimeMs
			},
			lastCheck: Date.now()
		};
		
		if (this.config.get('https_ca_file')) {
			// optional chain.pem or the like
			mgr.files.ca = this.config.get('https_ca_file');
			mgr.opts.ca = fs.readFileSync( this.config.get('https_ca_file') );
			mgr.mods.ca = fs.statSync(this.config.get('https_ca_file')).mtimeMs;
		}
		
		this.logDebug(3, "Loading SSL cert", mgr.files);
		
		// save mgr for later use
		// also, only assign this at the very end in case a reload crashes
		this.certMgr = mgr;
	}
	
	monitorCert() {
		// keep track of cert changes on disk
		var self = this;
		var mgr = this.certMgr;
		
		// every N seconds
		var now = Date.now();
		if (now - mgr.lastCheck < this.config.get('https_cert_poll_ms')) return;
		mgr.lastCheck = now;
		
		// stat files async as to not stall the event loop
		var mods = {};
		async.eachSeries( Object.keys(mgr.files),
			function(key, callback) {
				fs.stat( mgr.files[key], function(err, stats) {
					mods[key] = stats ? stats.mtimeMs : 0;
					callback();
				} );
			},
			function() {
				// did anything change?
				var changed = false;
				for (var key in mgr.files) {
					if (mods[key] && (mgr.mods[key] != mods[key])) changed = true;
				}
				if (!changed) return;
				
				// reload now!
				self.logDebug(3, "SSL cert has changed on disk, reloading now");
				
				// reloading is rare, so we can do it with sync calls
				// however, catch error here so a bad file doesn't bring down the whole server
				try { 
					self.reloadCert();
					
					// now infuse the new certs into all applicable listeners
					self.listeners.forEach( function(listener) {
						if (listener.setSecureContext) listener.setSecureContext( self.certMgr.opts );
					} );
					
					self.logDebug(3, "SSL cert reload complete");
				}
				catch (err) {
					self.logError('cert', "Failed to reload SSL cert: " + err);
				}
			}
		); // eachSeries
	}
	
	startHTTPS(port, callback) {
		// start https server
		var self = this;
		var bind_addr = this.config.get('https_bind_address') || this.config.get('http_bind_address') || '';
		var max_conns = this.config.get('https_max_connections') || this.config.get('http_max_connections') || 0;
		var socket_prelim_timeout = self.config.get('https_socket_prelim_timeout') || self.config.get('http_socket_prelim_timeout') || 0;
		
		this.logDebug(2, "Starting HTTPS (SSL) server on port: " + port, bind_addr );
		
		var handler = function(request, response) {
			if (socket_prelim_timeout && request.socket._pixl_data.prelim_timer) {
				clearTimeout( request.socket._pixl_data.prelim_timer );
				delete request.socket._pixl_data.prelim_timer;
			}
			
			// add a flag in headers for downstream code to detect
			request.headers['ssl'] = 1;
			request.headers['https'] = 1;
			
			self.enqueueHTTPRequest( request, response );
		};
		
		var listener = https.createServer( self.certMgr.opts, handler );
		
		listener.on('secureConnection', function(socket) {
			var ip = socket.remoteAddress || '';
			
			if (max_conns && (self.numConns >= max_conns)) {
				// reached maximum concurrent connections, abort new ones
				self.logError('maxconns', "Maximum concurrent connections reached, denying request from: " + ip, { host: socket.servername || '', ip: ip, port: port, max: max_conns });
				socket.end();
				socket.unref();
				socket.destroy(); // hard close
				self.dumpAllRequests();
				return;
			}
			if (self.server.shut) {
				// server is shutting down, abort new connections
				self.logError('shutdown', "Server is shutting down, denying connection from: " + ip, { host: socket.servername || '', ip: ip, port: port});
				socket.end();
				socket.unref();
				socket.destroy(); // hard close
				return;
			}
			if (ip && self.aclBlacklist.checkAny(ip)) {
				self.logError('blacklist', "IP is blacklisted, denying connection from: " + ip, { host: socket.servername || '', ip: ip, port: port });
				socket.end();
				socket.unref();
				socket.destroy(); // hard close
				return;
			}
			
			// SNI: check allow list at socket connect time
			if (self.httpsAllowHosts.length && !self.httpsAllowHosts.includes( ('' + socket.servername).toLowerCase() )) {
				self.logError('allowhosts', "SNI host not allowed: " + (socket.servername || 'n/a'), { host: socket.servername || '', ip: ip, port: port });
				socket.end();
				socket.unref();
				socket.destroy(); // hard close
				return;
			}
			
			var id = self.getNextId('cs');
			self.conns[ id ] = socket;
			self.numConns++;
			self.logDebug(8, "New incoming HTTPS (SSL) connection: " + id, { host: socket.servername || '', ip: ip, port: port, num_conns: self.numConns });
			
			// Disable the Nagle algorithm.
			socket.setNoDelay( true );
			
			// add our own metadata to socket
			socket._pixl_data = {
				id: id,
				port: port,
				proto: 'https',
				port: port,
				time_start: (new Date()).getTime(),
				num_requests: 0,
				bytes_in: 0,
				bytes_out: 0
			};
			
			// optional preliminary socket timeout for first request
			if (socket_prelim_timeout) {
				socket._pixl_data.prelim_timer = setTimeout( function() {
					delete socket._pixl_data.prelim_timer;
					var msg = "Socket preliminary timeout waiting for initial request (" + socket_prelim_timeout + " seconds)";
					var err_args = {
						ip: ip,
						port: port,
						pending: self.queue.length(),
						active: self.queue.running(),
						sockets: self.numConns
					};
					if (self.config.get('http_log_socket_errors')) {
						self.logError('socket', "Socket error: " + socket._pixl_data.id + ": " + msg, err_args);
					}
					else {
						self.logDebug(5, "Socket error: " + socket._pixl_data.id + ": " + msg, err_args);
					}
					
					socket._pixl_data.aborted = true;
					socket.end();
					socket.unref();
					socket.destroy(); // hard close
				}, socket_prelim_timeout * 1000 );
			} // socket_prelim_timeout
			
			self.emit('socket', socket);
			
			socket.on('error', function(err) {
				// client aborted connection?
				var args = socket._pixl_data.current || { request: {} };
				var msg = err.message;
				if (err.errno && ErrNo.code[err.errno]) {
					msg = self.ucfirst(ErrNo.code[err.errno].description) + " (" + err.message + ")";
				}
				if (self.config.get('http_log_socket_errors')) {
					self.logError(err.code || 'socket', "Socket error: " + id + ": " + msg, {
						ip: ip,
						ips: args.ips,
						port: port,
						state: args.state,
						method: args.request.method,
						uri: args.request.url,
						pending: self.queue.length(),
						active: self.queue.running(),
						sockets: self.numConns
					});
				}
				if (args.callback) {
					args.http_code = 0;
					args.http_status = "Socket Error";
					self.finishRequest(args);
				}
			} );
			
			socket.on('close', function() {
				// socket has closed
				if (socket._pixl_data.prelim_timer) {
					clearTimeout( socket._pixl_data.prelim_timer );
					delete socket._pixl_data.prelim_timer;
				}
				var now = (new Date()).getTime();
				self.logDebug(8, "HTTPS (SSL) connection has closed: " + id, {
					ip: ip,
					port: port,
					total_elapsed: now - socket._pixl_data.time_start,
					num_requests: socket._pixl_data.num_requests,
					bytes_in: socket._pixl_data.bytes_in,
					bytes_out: socket._pixl_data.bytes_out
				});
				delete self.conns[ id ];
				self.numConns--;
				socket._pixl_data.aborted = true;
			} );
		} );
		
		listener.on('clientError', function(err, socket) {
			// https://nodejs.org/api/http.html#http_event_clienterror
			if (!socket._pixl_data) socket._pixl_data = {};
			var args = socket._pixl_data.current || { request: {}, id: 'n/a' };
			var msg = err.message;
			
			if (err.errno && ErrNo.code[err.errno]) {
				msg = self.ucfirst(ErrNo.code[err.errno].description) + " (" + err.message + ")";
			}
			
			var err_args = {
				id: args.id,
				ip: socket.remoteAddress,
				ips: args.ips,
				port: port,
				state: args.state,
				method: args.request.method,
				uri: args.request.url,
				pending: self.queue.length(),
				active: self.queue.running(),
				sockets: self.numConns
			};
			if (self.config.get('http_log_socket_errors')) {
				self.logError(err.code || 'socket', "Client error: " + socket._pixl_data.id + ": " + msg, err_args);
			}
			else {
				self.logDebug(5, "Client error: " + socket._pixl_data.id + ": " + msg, err_args);
			}
			
			// do not try to write to socket if already closed
			if ((err.code != 'ECONNRESET') && socket.writable) {
				if (err.code == 'HPE_INVALID_METHOD') socket.destroy();
				else socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
			}
			socket._pixl_data.aborted = true;
			
			if (args.callback) {
				args.http_code = 0;
				args.http_status = "Socket Error";
				self.finishRequest(args);
			}
		});
		
		listener.once('error', function(err) {
			// fatal startup error on HTTPS server, probably EADDRINUSE
			self.logError('startup', "Failed to start HTTPS listener on port: " + port + ": " + err.message);
			return callback(err);
		} );
		
		var listen_opts = { port: port };
		if (bind_addr) listen_opts.host = bind_addr;
		
		listener.listen( listen_opts, function(err) {
			if (err) {
				self.logError('startup', "Failed to start HTTPS listener on port: " + port + ": " + err.message);
				return callback(err);
			}
			var info = listener.address();
			self.logDebug(3, "Now listening for HTTPS connections", info);
			if (!port) {
				port = info.port;
				self.config.set('https_port', port);
				self.logDebug(3, "Actual HTTPS listener port chosen: " + port);
			}
			self.listeners.push(listener);
			
			// LEGACY HACK -- FOR CRONICLE VERSIONS UNDER v0.9.34
			self.https = listener;
			
			callback();
		} );
		
		// set idle socket timeout
		var timeout_sec = this.config.get('https_timeout') || this.config.get('http_timeout') || 0;
		if (timeout_sec) {
			listener.setTimeout( timeout_sec * 1000 );
		}
		if (this.config.get('https_keep_alive_timeout')) {
			listener.keepAliveTimeout = this.config.get('https_keep_alive_timeout') * 1000;
		}
		else if (this.config.get('http_keep_alive_timeout')) {
			listener.keepAliveTimeout = this.config.get('http_keep_alive_timeout') * 1000;
		}
	}
	
};
