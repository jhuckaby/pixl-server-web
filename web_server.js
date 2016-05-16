// Simple HTTP / HTTPS Web Server
// A component for the pixl-server daemon framework.
// Copyright (c) 2015 - 2016 Joseph Huckaby
// Released under the MIT License

var Formidable = require('formidable');
var Querystring = require('querystring');
var Static = require('node-static');
var ErrNo = require('errno');
var fs = require('fs');
var os = require('os');
var zlib = require('zlib');

var Class = require("pixl-class");
var Component = require("pixl-server/component");

module.exports = Class.create({
	
	__name: 'WebServer',
	__parent: Component,
	
	defaultConfig: {
		http_regex_private_ip: "(^127\\.0\\.0\\.1)|(^10\\.)|(^172\\.1[6-9]\\.)|(^172\\.2[0-9]\\.)|(^172\\.3[0-1]\\.)|(^192\\.168\\.)",
		http_regex_text: "(text|javascript|json|css|html)",
		http_regex_json: "(javascript|js|json)",
		http_keep_alives: 1,
		http_timeout: 120,
		http_static_index: "index.html",
		http_static_ttl: 0,
		http_max_upload_size: 32 * 1024 * 1024,
		http_temp_dir: os.tmpDir(),
		http_gzip_opts: { level: zlib.Z_DEFAULT_COMPRESSION, memLevel: 8 }
	},
	
	conns: null,
	nextId: 1,
	uriHandlers: null,
	methodHandlers: null,
	
	startup: function(callback) {
		// start http server
		var self = this;
		
		// setup connections and handlers
		this.conns = {};
		this.uriHandlers = [];
		this.methodHandlers = [];
		this.regexPrivateIP = new RegExp( this.config.get('http_regex_private_ip') );
		this.regexTextContent = new RegExp( this.config.get('http_regex_text'), "i" );
		this.regexJSONContent = new RegExp( this.config.get('http_regex_json'), "i" );
		this.keepAlives = this.config.get('http_keep_alives');
		
		// prep static file server
		this.fileServer = new Static.Server( this.config.get('http_htdocs_dir'), {
			cache: this.config.get('http_static_ttl'),
			serverInfo: this.config.get('http_server_signature') || this.__name,
			gzip: this.config.get('http_gzip_text') ? this.regexTextContent : false,
			headers: JSON.parse( JSON.stringify(this.config.get('http_response_headers') || {}) ),
			indexFile: this.config.get('http_static_index')
		} );
		
		// front-end https header detection
		var ssl_headers = this.config.get('https_header_detect');
		if (ssl_headers) {
			this.ssl_header_detect = {};
			for (var key in ssl_headers) {
				this.ssl_header_detect[ key.toLowerCase() ] = new RegExp( ssl_headers[key] );
			}
		}
		
		// start listeners
		this.startHTTP( function() {
			// also start HTTPS listener?
			if (self.config.get('https')) {
				self.startHTTPS( callback );
			} // https
			else callback();
		} );
	},
	
	startHTTP: function(callback) {
		// start http server
		var self = this;
		var port = this.config.get('http_port');
		this.logDebug(2, "Starting HTTP server on port: " + port);
		
		this.http = require('http').createServer( function(request, response) {
			if (self.config.get('https_force')) {
				self.logDebug(6, "Forcing redirect to HTTPS (SSL)");
				request.headers.ssl = 1; // force SSL url
				var redirect_url = self.getSelfURL(request, request.url);
				
				self.sendHTTPResponse( 
					{ response: response }, 
					"301 Moved Permanently", 
					{ 'Location': redirect_url }, 
					"" // empty body
				);
			}
			else {
				self.parseHTTPRequest( request, response );
			}
		} );
		
		this.http.on('connection', function(socket) {
			var ip = socket.remoteAddress || '';
			var id = self.getNextId('c');
			self.conns[ id ] = socket;
			self.logDebug(8, "New incoming HTTP connection: " + id, { ip: ip });
			
			socket.on('error', function(err) {
				// client aborted connection?
				var msg = err.message;
				if (err.errno && ErrNo.code[err.errno]) {
					msg = ucfirst(ErrNo.code[err.errno].description) + " (" + err.message + ")";
				}
				self.logError(err.code || 1, "Socket error: " + id + ": " + msg, { ip: ip });
			} );
			
			socket.on('close', function() {
				self.logDebug(8, "HTTP connection has closed: " + id, { ip: ip });
				delete self.conns[ id ];
			} );
		} );
		
		this.http.listen( port, function(err) {
			if (err) {
				self.logError('http', "Failed to start HTTP listener: " + err.message);
				throw err;
				return;
			}
			if (!port) {
				port = self.http.address().port;
				self.config.set('http_port', port);
				self.logDebug(3, "Actual HTTP listener port chosen: " + port);
			}
			callback();
		} );
		
		// set idle socket timeout
		if (this.config.get('http_timeout')) {
			this.http.setTimeout( this.config.get('http_timeout') * 1000 );
		}
	},
	
	startHTTPS: function(callback) {
		// start https server
		var self = this;
		var port = this.config.get('https_port');
		this.logDebug(2, "Starting HTTPS (SSL) server on port: " + port);
		
		var opts = {
			cert: fs.readFileSync( this.config.get('https_cert_file') ),
			key: fs.readFileSync( this.config.get('https_key_file') )
		};
		
		this.https = require('https').createServer( opts, function(request, response) {
			// add a flag in headers for downstream code to detect
			request.headers['ssl'] = 1;
			request.headers['https'] = 1;
			
			self.parseHTTPRequest( request, response );
		} );
		
		this.https.on('connection', function(socket) {
			var ip = socket.remoteAddress || '';
			var id = self.getNextId('cs');
			self.conns[ id ] = socket;
			self.logDebug(8, "New incoming HTTPS (SSL) connection: " + id, { ip: ip });
			
			socket.on('error', function(err) {
				// client aborted connection?
				var msg = err.message;
				if (err.errno && ErrNo.code[err.errno]) {
					msg = ucfirst(ErrNo.code[err.errno].description) + " (" + err.message + ")";
				}
				self.logError(err.code || 1, "Socket error: " + id + ": " + msg, { ip: ip });
			} );
			
			socket.on('close', function() {
				self.logDebug(8, "HTTPS (SSL) connection has closed: " + id, { ip: ip });
				delete self.conns[ id ];
			} );
		} );
		
		this.https.listen( port, function(err) {
			if (err) {
				self.logError('http', "Failed to start HTTPS listener: " + err.message);
				throw err;
				return;
			}
			if (!port) {
				port = self.https.address().port;
				self.config.set('https_port', port);
				self.logDebug(3, "Actual HTTPS listener port chosen: " + port);
			}
			callback();
		} );
		
		// set idle socket timeout
		var timeout_sec = this.config.get('https_timeout') || this.config.get('http_timeout') || 0;
		if (timeout_sec) {
			this.https.setTimeout( timeout_sec * 1000 );
		}
	},
	
	addURIHandler: function(uri, name, callback) {
		// add custom handler for URI
		this.logDebug(3, "Adding custom URI handler: " + uri + ": " + name);
		if (typeof(uri) == 'string') {
			uri = new RegExp("^" + uri + "$");
		}
		this.uriHandlers.push({
			regexp: uri,
			name: name,
			callback: callback
		});
	},
	
	addMethodHandler: function(method, name, callback) {
		// add a handler for an entire request method, e.g. OPTIONS
		this.logDebug(3, "Adding custom request method handler: " + method + ": " + name);
		this.methodHandlers.push({
			method: method,
			name: name,
			callback: callback
		});
	},
	
	parseHTTPRequest: function(request, response) {
		// handle raw http request
		var self = this;
		var ips = this.getAllClientIPs(request);
		var ip = this.getPublicIP(ips);
		var args = {};
		
		this.logDebug(8, "New HTTP request: " + request.method + " " + request.url + " (" + ips.join(', ') + ")");
		this.logDebug(9, "Incoming HTTP Headers:", request.headers);
		
		// detect front-end https
		if (!request.headers.ssl && this.ssl_header_detect) {
			for (var key in this.ssl_header_detect) {
				if (request.headers[key] && request.headers[key].match(this.ssl_header_detect[key])) {
					this.logDebug(9, "Detected front-end HTTPS request: " + key + ": " + request.headers[key]);
					request.headers.ssl = 1;
					request.headers.https = 1;
					break;
				}
			}
		}
		
		// parse query string
		var query = {};
		if (request.url.match(/\?(.+)$/)) {
			query = Querystring.parse( RegExp.$1 );
		}
		
		// determine how to process request body
		var params = {};
		var files = {};
		
		// setup args for call to handler
		args.request = request;
		args.response = response;
		args.ip = ip;
		args.ips = ips;
		args.query = query;
		args.params = params;
		args.files = files;
		args.server = this;
		
		// post or get/head
		if (request.method == 'POST') {
			var content_type = request.headers['content-type'] || '';
			
			if (content_type.match(/(multipart|urlencoded)/i)) {
				// use formidable for the heavy lifting
				var form = new Formidable.IncomingForm();
				form.keepExtensions = true;
				form.maxFieldsSize = self.config.get('http_max_upload_size');
				form.hash = false;
				form.uploadDir = self.config.get('http_temp_dir');
				
				form.on('progress', function(bytesReceived, bytesExpected) {
					self.logDebug(10, "Upload progress: " + bytesReceived + " of " + bytesExpected + " bytes");
				} );
				
				form.parse(request, function(err, _fields, _files) {
					if (err) {
						self.logError("http", "Error processing POST from: " + ip + ": " + request.url + ": " + err);
						self.sendHTTPResponse( args, "400 Bad Request", {}, "400 Bad Request" );
						return;
					}
					else {
						args.params = _fields || {};
						args.files = _files || {};
						self.handleHTTPRequest(args);
					}
				} );
			}
			else {
				// parse ourselves (i.e. raw json)
				var bytesMax = self.config.get('http_max_upload_size');
				var bytesExpected = request.headers['content-length'] || "(Unknown)";
				var total_bytes = 0;
				var chunks = [];
				
				request.on('data', function(chunk) {
					// receive data chunk
					chunks.push( chunk );
					total_bytes += chunk.length;
					
					self.logDebug(10, "Upload progress: " + total_bytes + " of " + bytesExpected + " bytes");
					if (total_bytes > bytesMax) {
						self.logError("http", "Error processing POST from: " + ip + ": " + request.url + ": Max POST size exceeded");
						request.socket.end();
						return;
					}
				} );
				request.on('end', function() {
					// request body is complete
					var body = Buffer.concat(chunks, total_bytes);
					
					if (content_type.match( self.regexJSONContent )) {
						// parse json
						try {
							args.params = JSON.parse( body.toString() );
						}
						catch (e) {
							self.logError("http", "Error processing POST from: " + ip + ": " + request.url + ": Failed to parse JSON: " + e);
							self.sendHTTPResponse( args, "400 Bad Request", {}, "400 Bad Request" );
							return;
						}
					}
					else {
						// raw post, no parse
						args.params.raw = body;
					}
					
					// now we can handle the full request
					self.handleHTTPRequest(args);
				} );
			}
		} // post
		else {
			// non-post, i.e. get or head, handle right away
			this.handleHTTPRequest(args);
		}
	},
	
	handleHTTPRequest: function(args) {
		// determine if we have an API route
		var self = this;
		var uri = args.request.url.replace(/\?.*$/, '');
		var handler = null;
		
		// check method handlers first, e.g. OPTIONS
		for (var idx = 0, len = this.methodHandlers.length; idx < len; idx++) {
			if (this.methodHandlers[idx].method && (this.methodHandlers[idx].method == args.request.method)) {
				handler = this.methodHandlers[idx];
				idx = len;
			}
		}
		
		// only check URI handlers if no method handler matched
		if (!handler) {
			for (var idx = 0, len = this.uriHandlers.length; idx < len; idx++) {
				var matches = uri.match(this.uriHandlers[idx].regexp);
				if (matches) {
					args.matches = matches;
					handler = this.uriHandlers[idx];
					idx = len;
				}
			}
		}
		
		if (handler) {
			this.logDebug(6, "Invoking handler for request: " + args.request.method + ' ' + uri + ": " + handler.name);
			
			// parse HTTP cookies, if present
			args.cookies = {};
			if (args.request.headers['cookie']) {
				var pairs = args.request.headers['cookie'].split(/\;\s*/);
				for (var idx = 0, len = pairs.length; idx < len; idx++) {
					if (pairs[idx].match(/^([^\=]+)\=(.*)$/)) {
						args.cookies[ RegExp.$1 ] = RegExp.$2;
					}
				} // foreach cookie
			} // headers.cookie
			
			handler.callback( args, function() {
				// custom handler complete, send response
				if ((arguments.length == 3) && (typeof(arguments[0]) == "string")) {
					// handler sent status, headers and body
					self.sendHTTPResponse( args, arguments[0], arguments[1], arguments[2] );
				}
				else if (arguments[0] === true) {
					// true means handler sent the raw response itself
					self.logDebug(9, "Handler sent custom response");
				}
				else if (arguments[0] === false) {
					// false means handler did nothing, fall back to static
					self.logDebug(9, "Handler declined, falling back to static file");
					self.sendStaticResponse( args );
				}
				else if (typeof(arguments[0]) == "object") {
					// REST-style JSON response
					var json = arguments[0];
					self.logDebug(10, "API Response JSON:", json);
					
					var status = arguments[1] || "200 OK";
					var headers = arguments[2] || {};
					
					if (args.query.format && (args.query.format.match(/html/i)) && args.query.callback) {
						// old school IFRAME style response
						headers['Content-Type'] = "text/html";
						self.sendHTTPResponse( 
							args, 
							status, 
							headers, 
							'<html><head><script>' + 
								args.query.callback + "(" + JSON.stringify( json ) + ");\n" + 
								'</script></head><body>&nbsp;</body></html>' + "\n"
						);
					}
					else if (args.query.callback) {
						// JSON with JS callback wrapper
						headers['Content-Type'] = "text/javascript";
						self.sendHTTPResponse( 
							args, 
							status, 
							headers, 
							args.query.callback + "(" + JSON.stringify( json ) + ");\n"
						);
					}
					else {
						// pure json
						headers['Content-Type'] = "application/json";
						self.sendHTTPResponse( 
							args, 
							status, 
							headers, 
							JSON.stringify( json ) + "\n"
						);
					} // pure json
				} // json response
				else {
					// unknown response
					self.sendHTTPResponse( 
						args, 
						"500 Internal Server Error", 
						{ 'Content-Type': "text/html" }, 
						"500 Internal Server Error: URI handler returned unknown data type.\n"
					);
				}
				
				// delete temp files
				self.deleteUploadTempFiles(args);
			} );
		} // uri handler
		else {
			// no uri handler, serve static file instead
			this.sendStaticResponse( args );
			
			// delete temp files
			this.deleteUploadTempFiles(args);
		}
	},
	
	deleteUploadTempFiles: function(args) {
		// delete leftover temp files created by Formidable
		for (var key in args.files) {
			var file = args.files[key];
			fs.unlink( file.path, function(err) {
				// file may have been moved / deleted already, so ignore error here
			} );
		}
	},
	
	sendStaticResponse: function(args) {
		// serve static file for URI
		var self = this;
		var request = args.request;
		var response = args.response;
		this.logDebug(9, "Serving static file for: " + args.request.url);
		
		response.on('finish', function() {
			// response actually completed writing
			self.logDebug(9, "Response finished writing to socket");
			
			// HTTP Keep-Alive: only if enabled in config, and requested by client
			if (!self.keepAlives || !request.headers.connection || !request.headers.connection.match(/keep\-alive/i)) {
				// close socket
				request.socket.destroy();
			}
		} );
		
		this.fileServer.serve(request, response, function(err, result) {
			if (err) {
				self.logError("http", "Error serving static file: " + request.url + ": " + err.message);
				response.writeHead(err.status, err.headers);
				response.end();
			}
			else {
				self.logDebug(8, "Static HTTP response sent: " + result.status, result.headers);
			}
		});
	},
	
	sendHTTPResponse: function(args, status, headers, body) {
		// send http response
		var self = this;
		var request = args.request;
		var response = args.response;
		if (!headers) headers = {};
		
		// merge in default response headers
		var default_headers = this.config.get('http_response_headers') || null;
		if (default_headers) {
			for (var key in default_headers) {
				if (typeof(headers[key]) == 'undefined') headers[key] = default_headers[key];
			}
		}
		if (typeof(headers['Server']) == 'undefined') {
			headers['Server'] = this.config.get('http_server_signature') || this.__name;
		}
		
		// parse code and status
		var http_code = 200;
		var http_status = "OK";
		if (status.match(/^(\d+)\s+(.+)$/)) {
			http_code = parseInt( RegExp.$1 );
			http_status = RegExp.$2;
		}
		
		// use duck typing to see if we have a stream, buffer or string
		var is_stream = (body && body.pipe);
		var is_buffer = (body && body.fill);
		var is_string = (body && !is_stream && !is_buffer);
		
		// if string, convert to buffer so content length is correct (unicode)
		if (is_string) {
			body = new Buffer(body);
		}
		
		// set content-type if not already set
		if (body && !is_stream && (typeof(headers['Content-Length']) == 'undefined')) {
			headers['Content-Length'] = body.length;
		}
		
		response.on('finish', function() {
			// response actually completed writing
			self.logDebug(9, "Response finished writing to socket");
			
			// HTTP Keep-Alive: only if enabled in config, and requested by client
			if (!self.keepAlives || !request.headers.connection || !request.headers.connection.match(/keep\-alive/i)) {
				// close socket
				request.socket.destroy();
			}
		} );
		
		// auto-gzip response based on content type
		if (body && 
			(http_code == 200) && 
			this.config.get('http_gzip_text') && 
			headers['Content-Type'] && 
			headers['Content-Type'].match(this.regexTextContent) && 
			!headers['Content-Encoding'] && // do not encode if already encoded
			args.request && 
			args.request.headers['accept-encoding'] && 
			args.request.headers['accept-encoding'].match(/\bgzip\b/i)) {
			
			if (is_stream) {
				// stream pipe
				self.logDebug(9, "Sending streaming text output with gzip encoding");
				headers['Content-Encoding'] = 'gzip';
				
				self.logDebug(9, "Sending streaming HTTP response: " + status, headers);
				
				response.writeHead( http_code, http_status, headers );
				
				var gzip = zlib.createGzip( self.config.get('http_gzip_opts') || {} );
				body.pipe( gzip ).pipe( response );
				
				self.logDebug(9, "Request complete");
			}
			else {
				zlib.gzip(body, self.config.get('http_gzip_opts') || {}, function(err, data) {
					if (err) {
						// should never happen
						self.logError('http', "Failed to gzip compress content: " + err);
						data = body;
					}
					else {
						// no error
						body = null; // free up memory
						self.logDebug(9, "Compressed text output with gzip: " + headers['Content-Length'] + " bytes down to: " + data.length + " bytes");
						headers['Content-Length'] = data.length;
						headers['Content-Encoding'] = 'gzip';
					}
					
					self.logDebug(9, "Sending HTTP response: " + status, headers);
					
					// send data
					response.writeHead( http_code, http_status, headers );
					response.write( data );
					response.end();
					
					self.logDebug(9, "Request complete");
				}); // zlib.gzip
			} // buffer or string
		} // gzip
		else {
			// no compression
			if (is_stream) {
				this.logDebug(9, "Sending streaming HTTP response: " + status, headers);
				response.writeHead( http_code, http_status, headers );
				body.pipe( response );
			}
			else {
				this.logDebug(9, "Sending HTTP response: " + status, headers);
				
				// send data
				response.writeHead( http_code, http_status, headers );
				if (body) response.write( body );
				response.end();
			}
			this.logDebug(9, "Request complete");
		}
	},
	
	getAllClientIPs: function(request) {
		// create array of all IPs from the request, using the socket IP and X-Forwarded-For, if applicable
		var ips = [];
		if (request.headers['x-forwarded-for']) {
			ips = request.headers['x-forwarded-for'].split(/\,\s*/);
		}
		
		// add socket ip to end of array
		ips.push( request.socket.remoteAddress );
		
		return ips;
	},
	
	getPublicIP: function(ips) {
		// determine first public IP from list of IPs
		for (var idx = 0, len = ips.length; idx < len; idx++) {
			if (!ips[idx].match(this.regexPrivateIP)) return ips[idx];
		}
		
		// default to first ip
		return ips[0];
	},
	
	getSelfURL: function(request, uri) {
		// build self referencing URL given request object
		// and optional replacement URI
		var ssl = !!request.headers.ssl;
		var url = ssl ? 'https://' : 'http://';
		url += request.headers.host.replace(/\:\d+$/, '');
		
		if (ssl && (this.config.get('https_port') != 443)) url += ':' + this.config.get('https_port');
		else if (!ssl && (this.config.get('http_port') != 80)) url += ':' + this.config.get('http_port');
		
		url += (uri || '/');
		
		return url;
	},
	
	getNextId: function(prefix) {
		// get unique ID with prefix
		return '' + prefix + Math.floor(this.nextId++);
	},
	
	shutdown: function(callback) {
		// shutdown http server
		var self = this;
		
		if (this.http) {
			this.logDebug(2, "Shutting down HTTP server");
			
			for (var id in this.conns) {
				this.logDebug(9, "Closing HTTP connection: " + id);
				// this.conns[id].destroy();
				this.conns[id].end();
				this.conns[id].unref();
			}
			
			this.http.close( function() { self.logDebug(3, "HTTP server has shut down."); } );
			
			if (this.https) {
				this.https.close( function() { self.logDebug(3, "HTTPS server has shut down."); } );
			}
			// delete this.http;
		}
		callback();
	}
	
});

function ucfirst(text) {
	// capitalize first character only, lower-case rest
	return text.substring(0, 1).toUpperCase() + text.substring(1, text.length).toLowerCase();
};

