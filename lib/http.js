// Simple HTTP / HTTPS Web Server
// A component for the pixl-server daemon framework.
// Copyright (c) 2015 - 2021 Joseph Huckaby
// Released under the MIT License

const ErrNo = require('errno');
const Perf = require('pixl-perf');

module.exports = class HTTP {
	
	startHTTP(callback) {
		// start http server
		var self = this;
		var port = this.config.get('http_port');
		var bind_addr = this.config.get('http_bind_address') || '';
		var max_conns = this.config.get('http_max_connections') || 0;
		var https_force = self.config.get('https_force') || false;
		var socket_prelim_timeout = self.config.get('http_socket_prelim_timeout') || 0;
		
		this.logDebug(2, "Starting HTTP server on port: " + port, bind_addr);
		
		var handler = function(request, response) {
			if (socket_prelim_timeout && request.socket._pixl_data.prelim_timer) {
				clearTimeout( request.socket._pixl_data.prelim_timer );
				delete request.socket._pixl_data.prelim_timer;
			}
			if (https_force) {
				self.logDebug(6, "Forcing redirect to HTTPS (SSL)");
				request.headers.ssl = 1; // force SSL url
				
				var args = {
					request: request,
					response: response,
					perf: new Perf()
				};
				args.perf.begin();
				
				var redirect_url = self.getSelfURL(request, request.url);
				if (!redirect_url) {
					self.sendHTTPResponse( args, "400 Bad Request", {}, "" );
					return;
				}
				
				self.sendHTTPResponse( args, 
					"301 Moved Permanently", 
					{ 'Location': redirect_url }, 
					"" // empty body
				);
			}
			else {
				self.enqueueHTTPRequest( request, response );
			}
		};
		
		this.http = require('http').createServer( handler );
		
		this.http.on('connection', function(socket) {
			var ip = socket.remoteAddress || '';
			
			if (max_conns && (self.numConns >= max_conns)) {
				// reached maximum concurrent connections, abort new ones
				self.logError('maxconns', "Maximum concurrent connections reached, denying connection from: " + ip, { ip: ip, max: max_conns });
				socket.end();
				socket.unref();
				socket.destroy(); // hard close
				return;
			}
			if (self.server.shut) {
				// server is shutting down, abort new connections
				self.logError('shutdown', "Server is shutting down, denying connection from: " + ip, { ip: ip });
				socket.end();
				socket.unref();
				socket.destroy(); // hard close
				return;
			}
			
			var id = self.getNextId('c');
			self.conns[ id ] = socket;
			self.numConns++;
			self.logDebug(8, "New incoming HTTP connection: " + id, { ip: ip, num_conns: self.numConns });
			
			// Disable the Nagle algorithm.
			socket.setNoDelay( true );
			
			// add our own metadata to socket
			socket._pixl_data = {
				id: id,
				proto: 'http',
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
						state: args.state,
						method: args.request.method,
						uri: args.request.url,
						pending: self.queue.length(),
						active: self.queue.running(),
						sockets: self.numConns
					});
				}
				if (args.callback) {
					args.callback();
					delete args.callback;
				}
			} );
			
			socket.on('close', function() {
				// socket has closed
				if (socket._pixl_data.prelim_timer) {
					clearTimeout( socket._pixl_data.prelim_timer );
					delete socket._pixl_data.prelim_timer;
				}
				var now = (new Date()).getTime();
				self.logDebug(8, "HTTP connection has closed: " + id, {
					ip: ip,
					total_elapsed: now - socket._pixl_data.time_start,
					num_requests: socket._pixl_data.num_requests,
					bytes_in: socket._pixl_data.bytes_in,
					bytes_out: socket._pixl_data.bytes_out
				});
				delete self.conns[ id ];
				self.numConns--;
			} );
		} );
		
		this.http.on('clientError', function(err, socket) {
			// https://nodejs.org/api/http.html#http_event_clienterror
			if (!socket._pixl_data) socket._pixl_data = {};
			var args = socket._pixl_data.current || { request: {} };
			var msg = err.message;
			
			if (err.errno && ErrNo.code[err.errno]) {
				msg = self.ucfirst(ErrNo.code[err.errno].description) + " (" + err.message + ")";
			}
			
			var err_args = {
				id: args.id,
				ip: socket.remoteAddress,
				ips: args.ips,
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
			
			socket._pixl_data.aborted = true;
			socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
			
			if (args.callback) {
				args.callback();
				delete args.callback;
			}
		});
		
		this.http.once('error', function(err) {
			// fatal startup error on HTTP server, probably EADDRINUSE
			self.logError('startup', "Failed to start HTTP listener: " + err.message);
			return callback(err);
		} );
		
		var listen_opts = { port: port };
		if (bind_addr) listen_opts.host = bind_addr;
		
		this.http.listen( listen_opts, function(err) {
			if (err) {
				self.logError('startup', "Failed to start HTTP listener: " + err.message);
				return callback(err);
			}
			var info = self.http.address();
			self.logDebug(3, "Now listening for HTTP connections", info);
			if (!port) {
				port = info.port;
				self.config.set('http_port', port);
				self.logDebug(3, "Actual HTTP listener port chosen: " + port);
			}
			callback();
		} );
		
		// set idle socket timeout
		if (this.config.get('http_timeout')) {
			this.http.setTimeout( this.config.get('http_timeout') * 1000 );
		}
		if (this.config.get('http_keep_alive_timeout')) {
			this.http.keepAliveTimeout = this.config.get('http_keep_alive_timeout') * 1000;
		}
	}
	
};
