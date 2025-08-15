// Simple HTTP / HTTPS Web Server
// A component for the pixl-server daemon framework.
// Copyright (c) 2015 - 2021 Joseph Huckaby
// Released under the MIT License

const async = require('async');
const Formidable = require('formidable');
const Querystring = require('querystring');
const Perf = require('pixl-perf');
const Args = require('./args.js');

module.exports = class Request {

	enqueueHTTPRequest(request, response) {
		// enqueue request for handling as soon as concurrency limits allow
		var args = new Args({
			id: this.getNextId('r'),
			date: Date.now() / 1000,
			request: request,
			response: response,
			state: 'queued',
			perf: new Perf()
		});
		
		// take snapshot of req and socket counts at start of request, used by perf logger at end
		if (this.logPerfEnabled) {
			args._start = {
				pending: this.queue.length(),
				running: this.queue.running(),
				sockets: this.numConns
			};
		}
		
		args.perf.begin();
		
		var ips = args.ips = this.getAllClientIPs(request);
		var ip = args.ip = this.getPublicIP(ips);
		
		if (!request.socket.remoteAddress) {
			// weird situation: a request came in without a remoteAddress -- reject immediately
			this.logError(400, "No socket IP address -- rejecting request", 
				{ id: args.id, ips: ips, uri: request.url, headers: request.headers }
			);
			this.sendHTTPResponse( args, "400 Bad Request", {}, "" );
			return;
		}
		
		if (this.server.shut) {
			// server is shutting down, deny new requests
			this.logError(503, "Server is shutting down, denying request from: " + ip, 
				{ id: args.id, ips: ips, uri: request.url, headers: request.headers }
			);
			this.sendHTTPResponse( args, "503 Service Unavailable", {}, "503 Service Unavailable (server shutting down)" );
			return;
		}
		
		// socket ip was already checked against blacklist at connection time,
		// so here we only need to check the header IPs, if any
		if ((ips.length > 1) && this.aclBlacklist.checkAny( ips.slice(0, -1) )) {
			this.logError(403, "Forbidden: IP addresses blacklisted: " + ips.join(', '), {
				id: args.id,
				useragent: args.request.headers['user-agent'] || '',
				referrer: args.request.headers['referer'] || '',
				cookie: args.request.headers['cookie'] || '',
				url: this.getSelfURL(args.request, args.request.url) || args.request.url
			});
			this.sendHTTPResponse( args, 
				"403 Forbidden", 
				{ 'Content-Type': "text/html" }, 
				"403 Forbidden\n"
			);
			return;
		}
		
		// custom host allow list
		if (this.allowHosts.length && !this.allowHosts.includes( ('' + request.headers['host']).toLowerCase().replace(/\:\d+$/, '') )) {
			this.logError(403, "Forbidden: Host not allowed: " + (request.headers['host'] || 'n/a'), {
				id: args.id,
				host: request.headers['host'] || '',
				useragent: request.headers['user-agent'] || '',
				referrer: request.headers['referer'] || '',
				cookie: request.headers['cookie'] || '',
				url: this.getSelfURL(request, request.url) || request.url
			});
			this.sendHTTPResponse( args, 
				"403 Forbidden", 
				{ 'Content-Type': "text/html" }, 
				"403 Forbidden\n"
			);
			return;
		}
		
		// allow special URIs to skip the line
		if (this.queueSkipMatch && request.url.match(this.queueSkipMatch)) {
			this.logDebug(8, "Bumping request to front of queue: " + request.url);
			this.requests[ args.id ] = args;
			args.perf.begin('queue');
			this.queue.unshift(args);
			return;
		}
		
		if (this.maxQueueActive && (this.queue.running() >= this.maxQueueActive)) {
			// queue is maxed out on active reqs, reject request immediately
			this.logError(429, "Queue is maxed out (" + this.queue.running() + " active reqs), denying new request from: " + ip, { 
				id: args.id,
				ips: ips, 
				uri: request.url, 
				headers: request.headers,
				pending: this.queue.length(),
				active: this.queue.running(),
				sockets: this.numConns
			});
			this.sendHTTPResponse( args, "429 Too Many Requests", {}, "429 Too Many Requests (queue active maxed out)" );
			this.dumpAllRequests();
			return;
		}
		
		if (this.maxQueueLength && (this.queue.length() >= this.maxQueueLength)) {
			// queue is maxed out on pending reqs, reject request immediately
			this.logError(429, "Queue is maxed out (" + this.queue.length() + " pending reqs), denying new request from: " + ip, { 
				id: args.id,
				ips: ips, 
				uri: request.url, 
				headers: request.headers,
				pending: this.queue.length(),
				active: this.queue.running(),
				sockets: this.numConns
			});
			this.sendHTTPResponse( args, "429 Too Many Requests", {}, "429 Too Many Requests (queue pending maxed out)" );
			this.dumpAllRequests();
			return;
		}
		
		this.requests[ args.id ] = args;
		
		args.perf.begin('queue');
		this.queue.push(args);
	}
	
	parseHTTPRequest(args, callback) {
		// handle raw http request
		// (async dequeue handler function)
		var self = this;
		var request = args.request;
		var ips = args.ips;
		var ip = args.ip;
		
		args.perf.end('queue');
		
		// all requests will end up in this callback here
		args.callback = function() {
			if (args.timer) { clearTimeout(args.timer); delete args.timer; }
			delete self.requests[ args.id ];
			callback();
		};
		
		// add timer for request timeout
		if (this.config.get('http_request_timeout')) {
			args.timer = setTimeout( function() {
				// request took too long
				delete args.timer;
				
				self.logError(408, "Request timed out: " + self.config.get('http_request_timeout') + " seconds", {
					id: args.id,
					socket: request.socket._pixl_data.id,
					ips: args.ips,
					url: self.getSelfURL(args.request, request.url) || request.url,
					state: args.state
				});
				
				self.sendHTTPResponse( args, 
					"408 Request Timeout", 
					{ 'Content-Type': "text/html" }, 
					"408 Request Timeout: " + self.config.get('http_request_timeout') + " seconds.\n"
				);
				
				self.deleteUploadTempFiles(args);
			}, this.config.get('http_request_timeout') * 1000 );
		}
		
		// check for early abort (client error)
		if (request.socket._pixl_data.aborted) {
			if (args.callback) {
				args.callback();
				delete args.callback;
			}
			return;
		}
		
		this.logDebug(8, "New HTTP request: " + request.method + " " + request.url + " (" + ips.join(', ') + ")", {
			id: args.id,
			socket: request.socket._pixl_data.id,
			version: request.httpVersion
		});
		this.logDebug(9, "Incoming HTTP Headers:", request.headers);
		
		// url rewrites
		for (var idx = 0, len = this.rewrites.length; idx < len; idx++) {
			var rewrite = this.rewrites[idx];
			if (request.url.match(rewrite.regexp)) {
				request.url = request.url.replace(rewrite.regexp, rewrite.url);
				this.logDebug(8, "URL rewritten to: " + request.url);
				if (rewrite.headers) {
					for (var key in rewrite.headers) {
						request.headers[key] = rewrite.headers[key];
					}
				}
				if (rewrite.last) idx = len;
			}
		}
		
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
		
		// optionally flatten query (latter prevails)
		if (this.config.get('http_flatten_query')) {
			for (var key in query) {
				if (typeof(query[key]) == 'object') query[key] = query[key].pop();
			}
		}
		
		// determine how to process request body
		var params = {};
		var files = {};
		
		// setup args for call to handler
		args.ip = ip;
		args.ips = ips;
		args.query = query;
		args.params = params;
		args.files = files;
		args.server = this;
		args.state = 'reading';
		
		if (this.server.shut) {
			// server is shutting down, deny new requests
			this.logError(503, "Server is shutting down, denying request from: " + ip, 
				{ id: args.id, ips: ips, uri: request.url, headers: request.headers }
			);
			this.sendHTTPResponse( args, "503 Service Unavailable", {}, "503 Service Unavailable (server shutting down)" );
			return;
		}
		
		args.perf.begin('read');
		
		// parse HTTP cookies, if present
		args.cookies = {};
		if (request.headers['cookie']) {
			var pairs = request.headers['cookie'].split(/\;\s*/);
			for (var idx = 0, len = pairs.length; idx < len; idx++) {
				if (pairs[idx].match(/^([^\=]+)\=(.*)$/)) {
					var key = RegExp.$1, value = RegExp.$2;
					try { args.cookies[ decodeURIComponent(key) ] = decodeURIComponent(value); }
					catch (err) { this.logError('cookie', "Malformed cookie header: " + pairs[idx] + ": " + err) }
				}
			} // foreach cookie
		} // headers.cookie
		
		// we have to guess at the http raw status + raw header size
		// as Node's http.js has already parsed it
		var raw_bytes_read = 0;
		raw_bytes_read += [request.method, request.url, 'HTTP/' + request.httpVersion + "\r\n"].join(' ').length;
		raw_bytes_read += request.rawHeaders.join("\r\n").length + 4; // CRLFx2
		args.perf.count('bytes_in', raw_bytes_read);
		
		// track current request in socket metadata
		request.socket._pixl_data.current = args;
		
		// post or get/head
		if ((request.method != 'HEAD') && (request.headers['content-length'] || request.headers['transfer-encoding'])) {
			var content_type = request.headers['content-type'] || '';
			var content_encoding = request.headers['content-encoding'] || '';
			
			if (content_type.match(/(multipart|urlencoded)/i) && !content_encoding) {
				// use formidable for the heavy lifting
				var form = Formidable.formidable({
					keepExtensions: true,
					maxFieldsSize: self.config.get('http_max_upload_size'),
					maxFileSize: self.config.get('http_max_upload_size'),
					uploadDir: self.config.get('http_temp_dir'),
					allowEmptyFiles: self.config.get('http_allow_empty_files') || false
				});
				
				form.on('progress', function(bytesReceived, bytesExpected) {
					self.logDebug(9, "Upload progress: " + bytesReceived + " of " + (bytesExpected || '(Unknown)') + " bytes", {
						socket: request.socket._pixl_data.id
					});
					args.perf.count('bytes_in', bytesReceived);
				} );
				
				form.parse(request, function(err, _fields, _files) {
					args.perf.end('read');
					
					if (err) {
						self.logError(400, "Error processing data from: " + ip + ": " + request.url + ": " + (err.message || err), 
							{ id: args.id, ips: ips, uri: request.url, headers: request.headers }
						);
						self.sendHTTPResponse( args, "400 Bad Request", {}, "400 Bad Request" );
						return;
					}
					else {
						// restore original formidable v1 API for our fields and files
						args.params = {};
						for (var key in _fields) {
							args.params[key] = (_fields[key].length == 1) ? _fields[key][0] : _fields[key];
						}
						
						args.files = {};
						if (_files) {
							for (var key in _files) {
								var file = _files[key][0];
								args.files[key] = {
									path: file.filepath,
									type: file.mimetype,
									name: file.originalFilename,
									size: file.size,
									mtime: file.mtime || file.lastModifiedDate
								};
							}
						}
						
						self.filterHTTPRequest(args);
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
					args.perf.count('bytes_in', chunk.length);
					
					self.logDebug(9, "Upload progress: " + total_bytes + " of " + bytesExpected + " bytes", {
						socket: request.socket._pixl_data.id
					});
					if (total_bytes > bytesMax) {
						self.logError(413, "Error processing data from: " + ip + ": " + request.url + ": Max data size exceeded", 
							{ id: args.id, ips: ips, uri: request.url, headers: request.headers }
						);
						request.socket.end();
						
						// note: request ending here without a call to sendHTTPResponse, hence the args.callback is fired
						if (args.callback) {
							args.callback();
							delete args.callback;
						}
						return;
					}
				} );
				request.on('end', function() {
					// request body is complete
					var body = Buffer.concat(chunks, total_bytes);
					
					if (content_type.match(self.regexJSONContent) && !content_encoding) {
						// parse json
						try {
							args.params = JSON.parse( body.toString() );
						}
						catch (e) {
							self.logError(400, "Error processing data from: " + ip + ": " + request.url + ": Failed to parse JSON: " + e, 
								{ id: args.id, ips: ips, uri: request.url, headers: request.headers, body: body.toString() }
							);
							self.sendHTTPResponse( args, "400 Bad Request", {}, "400 Bad Request" );
							return;
						}
					}
					else {
						// raw post, no parse
						args.params.raw = body;
					}
					
					// now we can handle the full request
					args.perf.end('read');
					self.filterHTTPRequest(args);
				} );
			}
		} // post
		else {
			// non-post, i.e. get or head, handle right away
			args.perf.end('read');
			this.filterHTTPRequest(args);
		}
	}
	
	filterHTTPRequest(args) {
		// apply URL filters to request, if any, before calling handlers
		var self = this;
		
		// quick early exit: no filters, jump out now
		if (!this.uriFilters.length) return this.handleHTTPRequest(args);
		
		// see which filters need to be applied
		var uri = args.request.url.replace(/\?.*$/, '');
		var filters = [];
		
		for (var idx = 0, len = this.uriFilters.length; idx < len; idx++) {
			if (uri.match(this.uriFilters[idx].regexp)) filters.push( this.uriFilters[idx] );
		}
		
		// if no filters matched, another quick early exit
		if (!filters.length) return this.handleHTTPRequest(args);
		
		args.state = 'filtering';
		
		// use async to allow filters to run in sequence
		async.eachSeries( filters,
			function(filter, callback) {
				self.logDebug(8, "Invoking filter for request: " + args.request.method + ' ' + uri + ": " + filter.name, { id: args.id });
				
				args.perf.begin('filter');
				filter.callback( args, function() {
					// custom filter complete
					args.perf.end('filter');
					
					if ((arguments.length == 3) && (typeof(arguments[0]) == "string")) {
						// filter sent status, headers and body
						self.sendHTTPResponse( args, arguments[0], arguments[1], arguments[2] );
						return callback("ABORT");
					}
					else if (arguments[0] === true) {
						// true means filter sent the raw response itself
						self.logDebug(9, "Filter sent custom response");
						return callback("ABORT");
					}
					else if (arguments[0] === false) {
						// false means filter exited normally
						self.logDebug(9, "Filter passthru, continuing onward");
						return callback();
					}
					else {
						// unknown response
						self.sendHTTPResponse( args, 
							"500 Internal Server Error", 
							{ 'Content-Type': "text/html" }, 
							"500 Internal Server Error: URI filter " + filter.name + " returned unknown data type.\n"
						);
						return callback("ABORT");
					}
				} );
			},
			function(err) {
				// all filters complete
				// if a filter handled the response, we're done
				if (err === "ABORT") {
					self.deleteUploadTempFiles(args);
					if (args.callback) {
						args.callback();
						delete args.callback;
					}
					return;
				}
				
				// otherwise, proceed to handling the request proper (method / URI handlers)
				self.handleHTTPRequest(args);
			}
		); // eachSeries
	}
	
	handleHTTPRequest(args) {
		// determine if we have an API route
		var self = this;
		var uri = args.request.url;
		if (!this.config.get('http_full_uri_match')) uri = uri.replace(/\?.*$/, '');
		var handler = null;
		
		// handle redirects first
		for (var idx = 0, len = this.redirects.length; idx < len; idx++) {
			var redirect = this.redirects[idx];
			var matches = args.request.url.match(redirect.regexp);
			if (matches) {
				// redirect now
				var headers = redirect.headers || {};
				
				// allow regexp-style placeholder substitution in target url
				headers.Location = redirect.url.replace(/\$(\d+)/g, function(m_all, m_g1) { return matches[ parseInt(m_g1) ]; });
				
				this.logDebug(8, "Redirecting to URL: " + headers.Location);
				this.sendHTTPResponse( args, redirect.status || "302 Found", headers, null );
				this.deleteUploadTempFiles(args);
				return;
			} // matched
		} // foreach redirect
		
		args.state = 'processing';
		args.perf.begin('process');
		
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
			this.logDebug(6, "Invoking handler for request: " + args.request.method + ' ' + uri + ": " + handler.name, { id: args.id });
			
			// Check ACL here
			if (handler.acl) {
				if (handler.acl.checkAll(args.ips)) {
					// yay!
					this.logDebug(9, "ACL allowed request", args.ips);
				}
				else {
					// nope
					this.logError(403, "Forbidden: IP addresses rejected by ACL: " + args.ips.join(', '), {
						id: args.id,
						acl: handler.acl.toString(),
						useragent: args.request.headers['user-agent'] || '',
						referrer: args.request.headers['referer'] || '',
						cookie: args.request.headers['cookie'] || '',
						url: this.getSelfURL(args.request, args.request.url) || args.request.url
					});
					
					args.perf.end('process');
					
					this.sendHTTPResponse( args, 
						"403 Forbidden", 
						{ 'Content-Type': "text/html" }, 
						"403 Forbidden: ACL disallowed request.\n"
					);
					
					this.deleteUploadTempFiles(args);
					return;
				} // not allowed
			} // acl check
			
			handler.callback( args, function() {
				// custom handler complete, send response
				if ((arguments.length == 3) && (typeof(arguments[0]) == "string")) {
					// handler sent status, headers and body
					args.perf.end('process');
					self.sendHTTPResponse( args, arguments[0], arguments[1], arguments[2] );
				}
				else if (arguments[0] === true) {
					// true means handler sent the raw response itself
					args.resp_headers = { ...args.response.getHeaders() };
					
					if (args.request.socket.destroyed) {
						args.http_code = 0;
						args.http_status = 'Socket Closed';
						self.logDebug(9, "Socket closed during custom response");
					}
					else {
						args.http_code = args.response.statusCode || 0;
						args.http_status = args.response.statusMessage || '';
						self.logDebug(9, "Handler sent custom response", {
							statusCode: args.http_code,
							statusMessage: args.http_status,
							headers: args.resp_headers
						});
					}
					
					self.finishRequest(args);
				}
				else if (arguments[0] === false) {
					// false means handler did nothing, fall back to static
					self.logDebug(9, "Handler declined, falling back to static file");
					args.perf.end('process');
					self.sendStaticResponse( args );
				}
				else if (typeof(arguments[0]) == "object") {
					// REST-style JSON response
					var json = arguments[0];
					self.logDebug(10, "API Response JSON:", json);
					args.perf.end('process');
					
					var status = arguments[1] || "200 OK";
					var headers = arguments[2] || {};
					var payload = args.query.pretty ? JSON.stringify(json, null, "\t") : JSON.stringify(json);
					
					if (args.query.format && (args.query.format.match(/html/i)) && args.query.callback && self.config.get('http_legacy_callback_support')) {
						// old school IFRAME style response
						headers['Content-Type'] = "text/html";
						self.sendHTTPResponse( args, 
							status, 
							headers, 
							'<html><head><script>' + 
								args.query.callback + "(" + payload + ");\n" + 
								'</script></head><body>&nbsp;</body></html>' + "\n"
						);
					}
					else if (args.query.callback && self.config.get('http_legacy_callback_support')) {
						// JSON with JS callback wrapper
						headers['Content-Type'] = "text/javascript";
						self.sendHTTPResponse( args, 
							status, 
							headers, 
							args.query.callback + "(" + payload + ");\n"
						);
					}
					else {
						// pure json
						headers['Content-Type'] = "application/json";
						self.sendHTTPResponse( args, 
							status, 
							headers, 
							payload + "\n"
						);
					} // pure json
				} // json response
				else {
					// unknown response
					self.sendHTTPResponse( args, 
						"500 Internal Server Error", 
						{ 'Content-Type': "text/html" }, 
						"500 Internal Server Error: URI handler " + handler.name + " returned unknown data type.\n"
					);
				}
				
				// delete temp files
				self.deleteUploadTempFiles(args);
			} );
		} // uri handler
		else {
			// no uri handler, serve static file instead
			args.perf.end('process');
			this.sendStaticResponse( args );
			
			// delete temp files
			this.deleteUploadTempFiles(args);
		}
	}
	
};
