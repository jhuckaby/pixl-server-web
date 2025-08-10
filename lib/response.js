// Simple HTTP / HTTPS Web Server
// A component for the pixl-server daemon framework.
// Copyright (c) 2015 - 2021 Joseph Huckaby
// Released under the MIT License

const zlib = require('zlib');
const StreamMeter = require("stream-meter");

module.exports = class Response {
	
	sendHTTPResponse(args, status, headers, body) {
		// send http response
		var self = this;
		var request = args.request;
		var response = args.response;
		
		// copy headers object so we don't clobber user data
		if (headers) headers = Object.assign({}, headers);
		else headers = {};
		
		// in case the URI handler called sendHTTPResponse() directly, end the process metric
		if (args.perf && args.perf.perf.process && !args.perf.perf.process.end) args.perf.end('process');
		
		// check for destroyed socket
		if (args.request.socket.destroyed) {
			var socket_data = args.request.socket._pixl_data;
			delete socket_data.current;
			socket_data.total_elapsed = (new Date()).getTime() - socket_data.time_start;
			socket_data.url = this.getSelfURL(request, request.url) || request.url;
			socket_data.ips = args.ips;
			socket_data.req_id = args.id;
			
			if (this.config.get('http_log_socket_errors')) {
				this.logError('socket', "Socket closed unexpectedly: " + socket_data.id, socket_data);
			}
			else {
				this.logDebug(9, "Socket closed unexpectedly: " + socket_data.id, socket_data);
			}
			
			args.http_code = 0;
			args.http_status = "Socket Closed";
			this.finishRequest(args);
			
			// destroy stream if appliable (prevents filehandle leak)
			if (body && body.pipe && body.destroy) body.destroy();
			
			return;
		} // destroyed socket
		
		// catch double-callback
		if (args.state == 'writing') {
			this.logError('write', "Warning: Double call to sendHTTPResponse on same request detected.  Aborting second call.");
			return;
		}
		
		args.state = 'writing';
		
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
		
		// possibly overwrite 'Connection' header for KA closure
		this.manageKeepAliveResponse(args, headers);
		
		// parse code and status
		var http_code = 200;
		var http_status = "OK";
		if (status.match(/^(\d+)\s+(.+)$/)) {
			http_code = parseInt( RegExp.$1 );
			http_status = RegExp.$2;
		}
		args.http_code = http_code;
		args.http_status = http_status;
		
		// merge in conditional headers based on response code
		var code_headers = this.config.get('http_code_response_headers');
		if (code_headers && (http_code in code_headers)) {
			this.logDebug(9, "Injecting custom response headers for HTTP code: " + http_code, code_headers[http_code]);
			for (var key in code_headers[http_code]) {
				headers[key] = code_headers[http_code][key];
			}
		}
		
		// merge in conditional headers based on URI
		var uri = request.url;
		if (!this.config.get('http_full_uri_match')) uri = uri.replace(/\?.*$/, '');
		
		this.uriResponseHeaders.forEach( function(item) {
			if (!uri.match(item.regexp)) return;
			self.logDebug(9, "Injecting custom response headers for URI match: " + item.regexp, item.headers);
			
			for (var key in item.headers) {
				headers[key] = item.headers[key];
			}
		} );
		
		// use duck typing to see if we have a stream, buffer or string
		var is_stream = (body && body.pipe);
		var is_buffer = (body && body.fill);
		var is_string = (body && !is_stream && !is_buffer);
		
		// if string, convert to buffer so content length is correct (unicode)
		if (is_string) {
			body = Buffer.from(body);
		}
		
		// set content-type if not already set
		if (body && !is_stream && (typeof(headers['Content-Length']) == 'undefined')) {
			headers['Content-Length'] = body.length;
		}
		
		// copy stuff into args for detail logging
		if (this.logRequestDetails) {
			if (headers['Content-Encoding']) args.resp_body = Buffer.from("(Compressed)"); else args.resp_body = body;
			args.resp_headers = headers;
		}
		
		// track stream bytes, if applicable
		var meter = null;
		
		response.on('finish', function() {
			// response actually completed writing
			self.logDebug(9, "Response finished writing to socket", { id: args.id });
			
			// guess number of bytes in response header, minus data payload
			args.perf.count('bytes_out', ("HTTP " + args.http_code + " OK\r\n").length);
			for (var key in headers) {
				args.perf.count('bytes_out', (key + ": " + headers[key] + "\r\n").length);
			}
			args.perf.count('bytes_out', 4); // CRLFx2
			
			// add metered bytes if streamed
			if (meter) args.perf.count('bytes_out', meter.bytes || 0);
			
			// done writing
			args.perf.end('write');
			self.finishRequest(args);
		} );
		
		response.on('close', function() {
			if (args.callback) { 
				// socket closed during active response
				if (self.config.get('http_log_socket_errors')) {
					self.logError('socket', "Socket connection terminated unexpectedly during response", {
						id: args.id,
						ips: args.ips,
						useragent: request.headers['user-agent'] || '',
						referrer: request.headers['referer'] || '',
						cookie: request.headers['cookie'] || '',
						url: self.getSelfURL(request, request.url) || request.url
					});
				}
				
				args.http_code = 0;
				args.http_status = "Socket Closed";
				self.finishRequest(args);
			}
		});
		
		// handle stream errors (abort response)
		if (is_stream) {
			body.on('error', function(err) {
				self.logError('stream', "Stream error serving response: " + request.url + ": " + err.message, {
					id: args.id,
					ips: args.ips,
					useragent: request.headers['user-agent'] || '',
					referrer: request.headers['referer'] || '',
					cookie: request.headers['cookie'] || '',
					url: self.getSelfURL(request, request.url) || request.url
				});
				
				args.http_code = 500;
				args.http_status = "Internal Server Error";
				args.perf.count('errors', 1);
				
				body.unpipe();
				response.end();
			});
		}
		
		// see if handler has requested gzip, or auto-detect it
		var do_compress = headers['X-Compress'] || headers['x-compress'] || false;
		if (!do_compress) {
			do_compress = !!(
				this.compressText && 
				headers['Content-Type'] && 
				headers['Content-Type'].match(this.regexTextContent)
			);
		}
		
		// auto-gzip response based on content type
		if (body && 
			(http_code == 200) && 
			do_compress && 
			!headers['Content-Encoding'] && // do not encode if already encoded
			args.request && 
			args.request.headers['accept-encoding'] && 
			args.request.headers['accept-encoding'].match(self.acceptEncodingMatch)) {
			
			// prep encoding compression
			var compressor = null;
			var zlib_opts = null;
			var zlib_func = '';
			var accept_encoding = args.request.headers['accept-encoding'].toLowerCase();
			
			if (self.hasBrotli && accept_encoding.match(/\b(br)\b/)) {
				// prefer brotli first, if supported by Node.js
				zlib_func = 'brotliCompress';
				zlib_opts = self.config.get('http_brotli_opts') || {};
				headers['Content-Encoding'] = 'br';
				if (is_stream) compressor = zlib.createBrotliCompress( zlib_opts );
			}
			else if (accept_encoding.match(/\b(gzip)\b/)) {
				// prefer gzip second
				zlib_func = 'gzip';
				zlib_opts = self.config.get('http_gzip_opts') || {};
				headers['Content-Encoding'] = 'gzip';
				if (is_stream) compressor = zlib.createGzip( zlib_opts );
			}
			else if (accept_encoding.match(/\b(deflate)\b/)) {
				// prefer deflate third
				zlib_func = 'deflate';
				zlib_opts = self.config.get('http_gzip_opts') || {}; // yes, same opts as gzip
				headers['Content-Encoding'] = 'deflate';
				if (is_stream) compressor = zlib.createDeflate( zlib_opts );
			}
			
			if (is_stream) {
				// send response as stream pipe
				delete headers['Content-Length'];
				self.logDebug(9, "Sending compressed streaming HTTP response with " + zlib_func + ": " + status, headers);
				args.perf.begin('write');
				
				if (self.writeHead( args, http_code, http_status, headers )) {
					meter = new StreamMeter();
					body.pipe( compressor ).pipe( meter ).pipe( response );
					self.logDebug(9, "Request complete");
				}
			}
			else {
				// compress and send response as buffer
				args.perf.begin('encode');
				zlib[ zlib_func ]( body, zlib_opts, function(err, data) {
					args.perf.end('encode');
					args.perf.begin('write');
					if (err) {
						// should never happen
						self.logError('zlib', "Failed to compress content with " + zlib_func + ": " + err);
						data = body;
					}
					else {
						// no error
						body = null; // free up memory
						self.logDebug(9, "Compressed text output with " + zlib_func + ": " + headers['Content-Length'] + " bytes down to: " + data.length + " bytes");
						headers['Content-Length'] = data.length;
					}
					
					self.logDebug(9, "Sending compressed HTTP response with " + zlib_func + ": " + status, headers);
					
					// send data
					if (self.writeHead( args, http_code, http_status, headers )) {
						response.write( data );
						response.end();
						
						args.perf.count('bytes_out', data.length);
						self.logDebug(9, "Request complete");
					}
				}); // zlib
			} // buffer or string
		} // compress
		else {
			// no compression
			args.perf.begin('write');
			
			if (is_stream) {
				this.logDebug(9, "Sending streaming HTTP response: " + status, headers);
				
				if (self.writeHead( args, http_code, http_status, headers )) {
					meter = new StreamMeter();
					body.pipe( meter ).pipe( response );
				}
			}
			else {
				this.logDebug(9, "Sending HTTP response: " + status, headers);
				
				// send data
				if (self.writeHead( args, http_code, http_status, headers )) {
					if (body) {
						response.write( body );
						args.perf.count('bytes_out', body.length);
					}
					response.end();
				}
			}
			this.logDebug(9, "Request complete", { id: args.id });
		}
	}
	
	writeHead(args, http_code, http_status, headers) {
		// wrap call to response.writeHead(), as it can throw
		var request = args.request;
		var response = args.response;
		
		if (headers && this.config.get('http_clean_headers')) {
			// prevent bad characters in headers, which can crash node's writeHead() call
			for (var key in headers) {
				if (typeof(headers[key]) == 'object') {
					for (var idx = 0, len = headers[key].length; idx < len; idx++) {
						headers[key][idx] = headers[key][idx].toString().replace(this.badHeaderCharPattern, '');
					}
				}
				else {
					headers[key] = headers[key].toString().replace(this.badHeaderCharPattern, '');
				}
			}
		}
		
		response.writeHead( http_code, http_status, headers || {} );
		return true;
	}
	
	finishRequest(args) {
		// finish up request tracking
		if (args.requestFinished) return;
		args.requestFinished = true;
		
		args.perf.count('num_requests', 1);
		args.perf.end();
		
		var socket_data = args.request.socket._pixl_data;
		var metrics = args.perf.metrics();
		this.emit('metrics', metrics, args);
		
		this.logDebug(9, "Request performance metrics:", metrics);
		
		// write to access log
		if (this.logRequests && args.request.url.match(this.regexLogRequests)) {
			var data = {
				id: args.id,
				method: args.request.method,
				proto: args.request.headers['ssl'] ? 'https' : socket_data.proto,
				ip: args.ip,
				ips: args.ips,
				port: socket_data.port,
				socket: socket_data.id,
				perf: metrics
			};
			
			if (this.logRequestDetails) {
				// extra transaction log details
				data.files = args.files || {};
				data.headers = args.request.headers || {};
				data.cookies = args.cookies || {};
				data.query = args.query || {};
				data.params = Object.assign( {}, args.params || {} );
				
				// special handling for raw request body
				if (data.params.raw && data.params.raw.buffer && data.params.raw.toString) {
					if (args.request.headers['content-type'] && args.request.headers['content-type'].match(/(text|javascript|json|xml)/) && (data.params.raw.length <= this.logRequestBodyMax)) {
						data.params.raw = data.params.raw.toString('utf8');
					}
					else data.params.raw = '(Buffer)';
				}
				
				// include details on response as well
				data.response = {
					code: args.http_code,
					status: args.http_status,
					headers: {}
				};
				
				// convert header keys to lower-case
				if (args.resp_headers) {
					for (var key in args.resp_headers) {
						data.response.headers[ key.toLowerCase() ] = args.resp_headers[key];
					}
				}
				
				// special handling for stream and buffer responses
				if (args.resp_body && args.resp_body.pipe) {
					data.response.raw = '(Stream)';
				}
				else if (args.resp_body && args.resp_body.buffer && args.resp_body.toString) {
					if (data.response.headers && data.response.headers['content-type'] && data.response.headers['content-type'].match(/(text|javascript|json|xml)/) && (args.resp_body.length <= this.logRequestBodyMax)) {
						data.response.raw = args.resp_body.toString('utf8');
					}
					else data.response.raw = '(Buffer)';
				}
				
				// cleanup
				delete args.resp_body;
				delete args.resp_headers;
			}
			else {
				// standard transaction log
				data.host = args.request.headers['host'] || '';
				data.ua = args.request.headers['user-agent'] || '';
			}
			
			this.logTransaction( 'HTTP ' + args.http_code + ' ' + args.http_status, args.request.url, data );
		}
		
		// optional threshold-based perf log
		if (this.logPerfEnabled && (metrics.perf.total >= this.logPerfThreshold)) {
			var epoch = (Date.now() - metrics.perf.total) / 1000;
			var log_data = {
				id: args.id,
				proto: args.request.headers['ssl'] ? 'https' : socket_data.proto,
				ips: args.ips,
				host: args.request.headers['host'] || '',
				ua: args.request.headers['user-agent'] || '',
				perf: metrics,
				pending: args._start.pending,
				running: args._start.running,
				sockets: args._start.sockets
			};
			if (this.logPerfReport) {
				var report = process.report.getReport();
				if (Array.isArray(this.logPerfReport)) {
					log_data.report = {};
					this.logPerfReport.forEach( function(key) {
						if (key in report) log_data.report[key] = report[key];
					} );
				}
				else log_data.report = report;
			}
			this.logger.print({
				now: epoch, // retroactive time (start of request)
				category: 'perf', 
				code: args.http_code + ' ' + args.http_status, 
				msg: args.request.url,
				data: log_data
			});
		}
		
		// keep a list of the most recent N requests
		if (this.keepRecentRequests) {
			this.recent.unshift({
				id: args.id,
				when: (new Date()).getTime() / 1000,
				proto: args.request.headers['ssl'] ? 'https' : socket_data.proto,
				port: socket_data.port,
				code: args.http_code,
				status: args.http_status,
				method: args.request.method,
				uri: args.request.url,
				ip: args.ip,
				ips: args.ips,
				host: args.request.headers['host'] || '',
				ua: args.request.headers['user-agent'] || '',
				perf: metrics
			});
			if (this.recent.length > this.keepRecentRequests) this.recent.pop();
		}
		
		// add metrics to socket
		socket_data.num_requests++;
		socket_data.bytes_in += metrics.counters.bytes_in || 0;
		socket_data.bytes_out += metrics.counters.bytes_out || 0;
		
		// add metrics to stats system
		var stats = this.stats.current;
		
		for (var key in metrics.perf) {
			var elapsed = metrics.perf[key];
			if (!stats[key]) {
				stats[key] = {
					'st': 'mma', // stat type: "min max avg"
					'min': elapsed,
					'max': elapsed,
					'total': elapsed,
					'count': 1
				};
			}
			else {
				var stat = stats[key];
				if (elapsed < stat.min) stat.min = elapsed;
				else if (elapsed > stat.max) stat.max = elapsed;
				stat.total += elapsed;
				stat.count++;
			}
		}
		
		for (var key in metrics.counters) {
			var amount = metrics.counters[key];
			if (!stats[key]) stats[key] = 0;
			stats[key] += amount;
		}
		
		// remove reference to current request
		delete socket_data.current;
		
		// Handle HTTP Keep-Alives
		var request = args.request;
		
		// only do this if socket is still open
		if (args.http_code != 0) switch (this.keepAlives) {
			case 0:
			case 'close':
				// KA disabled, always close
				this.logDebug(9, "Closing socket: " + socket_data.id);
				request.socket.end(); // close nicely
			break;
			
			case 1:
			case 'request':
				// KA enabled only if client explicitly requests it
				if (!request.headers.connection || !request.headers.connection.match(/keep\-alive/i)) {
					// close socket
					this.logDebug(9, "Closing socket: " + socket_data.id);
					request.socket.end(); // close nicely
				}
				else {
					this.logDebug(9, "Keeping socket open for keep-alives: " + socket_data.id);
				}
			break;
			
			case 2:
			case 'default':
				// KA enabled by default, only disable if client says close
				if (request.headers.connection && request.headers.connection.match(/close/i)) {
					this.logDebug(9, "Closing socket: " + socket_data.id);
					request.socket.end(); // close nicely
				}
				else {
					this.logDebug(9, "Keeping socket open for keep-alives: " + socket_data.id);
				}
			break;
		} // switch
		
		// fire final request callback (queue)
		if (args.callback) {
			args.callback();
			delete args.callback;
		}
	}
	
	manageKeepAliveResponse(args, headers) {
		// massage outgoing headers for keep-alive requests
		// possibly override response 'Connection' header, if we want the client to close
		var request = args.request;
		var socket_data = request.socket._pixl_data || { num_requests: 0 };
		
		switch (this.keepAlives) {
			case 0:
			case 'close':
				// KA disabled, always close
				headers['Connection'] = 'close';
			break;
			
			case 1:
			case 'request':
				// KA enabled only if client explicitly requests it
				if (!request.headers.connection || !request.headers.connection.match(/keep\-alive/i)) {
					headers['Connection'] = 'close';
				}
				else if (this.maxReqsPerConn && (socket_data.num_requests >= this.maxReqsPerConn - 1)) {
					this.logDebug(8, "Closing socket after " + this.maxReqsPerConn + " keep-alive requests: " + socket_data.id);
					headers['Connection'] = 'close';
				}
				else if (this.server.shut) {
					this.logDebug(8, "Closing socket due to server shutting down: " + socket_data.id);
					headers['Connection'] = 'close';
				}
			break;
			
			case 2:
			case 'default':
				// KA enabled by default, only disable if client says close
				if (request.headers.connection && request.headers.connection.match(/close/i)) {
					headers['Connection'] = 'close';
				}
				else if (this.maxReqsPerConn && (socket_data.num_requests >= this.maxReqsPerConn - 1)) {
					this.logDebug(8, "Closing socket after " + this.maxReqsPerConn + " keep-alive requests: " + socket_data.id);
					headers['Connection'] = 'close';
				}
				else if (this.server.shut) {
					this.logDebug(8, "Closing socket due to server shutting down: " + socket_data.id);
					headers['Connection'] = 'close';
				}
			break;
		} // switch
	}
	
};
