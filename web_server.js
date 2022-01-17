// Simple HTTP / HTTPS Web Server
// A component for the pixl-server daemon framework.
// Copyright (c) 2015 - 2021 Joseph Huckaby
// Released under the MIT License

const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const async = require('async');
const Class = require("class-plus");
const Component = require("pixl-server/component");
const ACL = require('pixl-acl');

module.exports = Class({
	
	__mixins: [
		require('./lib/http.js'),
		require('./lib/https.js'),
		require('./lib/handlers.js'),
		require('./lib/request.js'),
		require('./lib/response.js'),
		require('./lib/static.js')
	],
	
	version: require( __dirname + '/package.json' ).version,
	
	defaultConfig: {
		http_private_ip_ranges: ['127.0.0.1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fd00::/8', '169.254.0.0/16', 'fe80::/10'],
		http_regex_text: "(text|javascript|json|css|html)",
		http_regex_json: "(javascript|js|json)",
		http_keep_alives: "default",
		http_timeout: 120,
		http_static_index: "index.html",
		http_static_ttl: 0,
		http_max_upload_size: 32 * 1024 * 1024,
		http_temp_dir: os.tmpdir(),
		http_gzip_opts: {
			level: zlib.constants.Z_DEFAULT_COMPRESSION, 
			memLevel: 8 
		},
		http_brotli_opts: {
			chunkSize: 16 * 1024,
			mode: "text",
			level: 4
		},
		http_compress_text: false,
		http_enable_brotli: false,
		http_default_acl: ['127.0.0.1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fd00::/8', '169.254.0.0/16', 'fe80::/10'],
		http_log_requests: false,
		http_recent_requests: 10,
		http_max_connections: 0,
		http_max_requests_per_connection: 0,
		http_max_concurrent_requests: 0,
		http_max_queue_length: 0,
		http_max_queue_active: 0,
		http_queue_skip_uri_match: false,
		http_clean_headers: false,
		http_log_socket_errors: true,
		http_full_uri_match: false,
		http_request_timeout: 0
	},
	
	conns: null,
	numConns: 0,
	nextId: 1,
	uriFilters: null,
	uriHandlers: null,
	methodHandlers: null,
	defaultACL: null,
	stats: null,
	recent: null,
	
	badHeaderCharPattern: /([\x7F-\xFF\x00-\x1F\u00FF-\uFFFF])/g
	
},
class WebServer extends Component {
	
	startup(callback) {
		// start http server
		var self = this;
		
		this.logDebug(2, "pixl-server-web v" + this.version + " starting up");
		
		// setup connections and handlers
		this.conns = {};
		this.requests = {};
		this.uriFilters = [];
		this.uriHandlers = [];
		this.methodHandlers = [];
		this.defaultACL = new ACL();
		this.aclPrivateRanges = new ACL( this.config.get('http_private_ip_ranges') );
		this.regexTextContent = new RegExp( this.config.get('http_regex_text'), "i" );
		this.regexJSONContent = new RegExp( this.config.get('http_regex_json'), "i" );
		this.logRequests = this.config.get('http_log_requests');
		this.regexLogRequests = this.logRequests ? (new RegExp( this.config.get('http_regex_log') || '.+' )) : null;
		this.keepRecentRequests = this.config.get('http_recent_requests');
		this.stats = { current: {}, last: {} };
		this.recent = [];
		
		// optionally compress text
		this.compressText = this.config.get('http_compress_text') || this.config.get('http_gzip_text');
		
		// brotli compression support
		this.hasBrotli = !!zlib.BrotliCompress && this.config.get('http_enable_brotli');
		this.acceptEncodingMatch = this.hasBrotli ? /\b(gzip|deflate|br)\b/i : /\b(gzip|deflate)\b/i;
		
		// map friendly keys to brotli constants
		var brotli_opts = this.config.get('http_brotli_opts');
		if ("mode" in brotli_opts) {
			switch (brotli_opts.mode) {
				case 'text': brotli_opts.mode = zlib.constants.BROTLI_MODE_TEXT; break;
				case 'font': brotli_opts.mode = zlib.constants.BROTLI_MODE_FONT; break;
				case 'generic': brotli_opts.mode = zlib.constants.BROTLI_MODE_GENERIC; break;
			}
			if (!brotli_opts.params) brotli_opts.params = {};
			brotli_opts.params[ zlib.constants.BROTLI_PARAM_MODE ] = brotli_opts.mode;
			delete brotli_opts.mode;
		}
		if ("level" in brotli_opts) {
			if (!brotli_opts.params) brotli_opts.params = {};
			brotli_opts.params[ zlib.constants.BROTLI_PARAM_QUALITY ] = brotli_opts.level;
			delete brotli_opts.level;
		}
		if ("hint" in brotli_opts) {
			if (!brotli_opts.params) brotli_opts.params = {};
			brotli_opts.params[ zlib.constants.BROTLI_PARAM_SIZE_HINT ] = brotli_opts.hint;
			delete brotli_opts.hint;
		}
		
		// keep-alives
		this.keepAlives = this.config.get('http_keep_alives');
		if (this.keepAlives === false) this.keepAlives = 0;
		else if (this.keepAlives === true) this.keepAlives = 1;
		
		// optional max requests per KA connection
		this.maxReqsPerConn = this.config.get('http_max_requests_per_connection');
		
		// setup queue to handle all requests
		this.maxConcurrentReqs = this.config.get('http_max_concurrent_requests') || this.config.get('http_max_connections');
		this.maxQueueLength = this.config.get('http_max_queue_length');
		this.maxQueueActive = this.config.get('http_max_queue_active');
		
		this.queueSkipMatch = this.config.get('http_queue_skip_uri_match') ? 
			new RegExp( this.config.get('http_queue_skip_uri_match') ) : false;
		
		// if both max concurrent req AND max connections are not set, just use a very large number
		this.queue = async.queue( this.parseHTTPRequest.bind(this), this.maxConcurrentReqs || 8192 );
		
		// front-end https header detection
		var ssl_headers = this.config.get('https_header_detect');
		if (ssl_headers) {
			this.ssl_header_detect = {};
			for (var key in ssl_headers) {
				this.ssl_header_detect[ key.toLowerCase() ] = new RegExp( ssl_headers[key] );
			}
		}
		
		// initialize default ACL blocks
		if (this.config.get('http_default_acl')) {
			try {
				this.config.get('http_default_acl').forEach( function(block) {
					self.defaultACL.add( block );
				} );
			}
			catch (err) {
				var err_msg = "Failed to initialize ACL: " + err.message;
				this.logError('acl', err_msg);
				throw new Error(err_msg);
			}
		}
		
		// listen for tick events to swap stat buffers
		this.server.on( 'tick', this.tick.bind(this) );
		
		// start listeners
		this.startHTTP( function(err) {
			if (err) return callback(err);
			
			// also start HTTPS listener?
			if (self.config.get('https')) {
				self.startHTTPS( callback );
			}
			else callback(err);
		} );
	}
	
	deleteUploadTempFiles(args) {
		// delete leftover temp files created by Formidable
		for (var key in args.files) {
			var file = args.files[key];
			fs.unlink( file.path, function(err) {
				// file may have been moved / deleted already, so ignore error here
			} );
		}
	}
	
	tick() {
		// swap current and last stat buffers
		// called every 1s via server tick event
		this.stats.last = this.stats.current;
		this.stats.current = {};
	}
	
	getStats() {
		// get current stats, merged with live socket and request info
		var socket_info = {};
		var listener_info = {};
		var now = (new Date()).getTime();
		var num_sockets = 0;
		
		if (this.http) listener_info.http = this.http.address();
		if (this.https) listener_info.https = this.https.address();
		
		for (var key in this.conns) {
			var socket = this.conns[key];
			var socket_data = socket._pixl_data;
			var info = {
				state: 'idle',
				ip: socket.remoteAddress,
				proto: socket_data.proto,
				port: socket_data.port,
				uptime_ms: now - socket_data.time_start,
				num_requests: socket_data.num_requests,
				bytes_in: socket_data.bytes_in,
				bytes_out: socket_data.bytes_out
			};
			if (socket_data.current) {
				// current request in progress, merge this in
				var args = socket_data.current;
				info.ips = args.ips;
				info.state = args.state;
				info.method = args.request.method;
				info.uri = args.request.url;
				info.host = args.request.headers['host'] || '';
				info.elapsed_ms = args.perf.calcElapsed( args.perf.perf.total.start );
			}
			socket_info[key] = info;
			num_sockets++;
		}
		
		var stats = this.stats.last;
		stats.num_sockets = num_sockets;
		if (!stats.num_requests) stats.num_requests = 0;
		if (!stats.bytes_in) stats.bytes_in = 0;
		if (!stats.bytes_out) stats.bytes_out = 0;
		
		['total', 'read', 'process', 'write'].forEach( function(key) {
			if (!stats[key]) stats[key] = { "st": "mma", "min": 0, "max": 0, "total": 0, "count": 0 };
		} );
		
		for (var key in stats) {
			var stat = stats[key];
			if ((stat.st == "mma") && ("total" in stat) && ("count" in stat)) {
				stat.avg = stat.total / (stat.count || 1);
			}
		}
		
		return {
			server: {
				uptime_sec: Math.floor(now / 1000) - this.server.started,
				hostname: this.server.hostname,
				ip: this.server.ip,
				name: this.server.__name,
				version: this.server.__version
			},
			stats: stats,
			listeners: listener_info,
			sockets: socket_info,
			recent: this.recent,
			queue: {
				pending: this.queue.length(),
				running: this.queue.running()
			}
		};
	}
	
	getAllClientIPs(request) {
		// create array of all IPs from the request, using the socket IP and X-Forwarded-For, if applicable
		var ips = [];
		var headers = request.headers || {};
		
		// single IP headers
		['x-client-ip', 'cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-cluster-client-ip'].forEach( function(key) {
			if (headers[key]) ips.push( headers[key] );
		} );
		
		// multi-CSV IP headers
		['x-forwarded-for', 'forwarded-for'].forEach( function(key) {
			if (headers[key]) [].push.apply( ips, headers[key].split(/\,\s*/) );
		} );
		
		// special headers
		// e.g. Forwarded: for=192.0.2.43, for="[2001:db8:cafe::17]"
		['x-forwarded', 'forwarded'].forEach( function(key) {
			if (headers[key]) headers[key].replace( /\bfor\=\"?\[?([^\,\]\"]+)/g, function(m_all, m_g1) {
				ips.push( m_g1 );
			} );
		} );
		
		// add socket ip to end of array
		var ip = ''+request.socket.remoteAddress;
		if (ip.match(/\:(\d+\.\d+\.\d+\.\d+)/)) ip = RegExp.$1; // extract IPv4 from IPv6 wrapper
		ips.push( ip );
		
		return ips;
	}
	
	getPublicIP(ips) {
		// filter out garbage that doesn't resemble ips
		var real_ips = ips.filter( function(ip) {
			return ip.match( /^([\d\.]+|[a-f0-9:]+)$/ );
		} );
		
		// determine first public IP from list of IPs
		for (var idx = 0, len = real_ips.length; idx < len; idx++) {
			if (!this.aclPrivateRanges.check(real_ips[idx])) return real_ips[idx];
		}
		
		// default to first ip
		return real_ips[0];
	}
	
	getSelfURL(request, uri) {
		// build self referencing URL given request object
		// and optional replacement URI
		if (!request.headers.host) return null;
		
		var ssl = !!request.headers.ssl;
		var url = ssl ? 'https://' : 'http://';
		url += request.headers.host.replace(/\:\d+$/, '');
		
		// only re-add port number if original incoming request had one
		if (request.headers.host.match(/\:\d+$/)) {
			if (ssl && this.config.get('https_port') && (this.config.get('https_port') != 443)) {
				url += ':' + this.config.get('https_port');
			}
			else if (!ssl && this.config.get('http_port') && (this.config.get('http_port') != 80)) {
				url += ':' + this.config.get('http_port');
			}
		}
		
		url += (uri || '/');
		
		return url;
	}
	
	getNextId(prefix) {
		// get unique ID with prefix
		return '' + prefix + Math.floor(this.nextId++);
	}
	
	ucfirst(text) {
		// capitalize first character only, lower-case rest
		return text.substring(0, 1).toUpperCase() + text.substring(1, text.length).toLowerCase();
	}
	
	shutdown(callback) {
		// shutdown http server
		var self = this;
		
		if (this.http) {
			this.logDebug(2, "Shutting down HTTP server");
			
			for (var id in this.requests) {
				var args = this.requests[id];
				this.logDebug(4, "Request still active: " + args.id, {
					id: args.id,
					ips: args.ips,
					uri: args.request ? args.request.url : '',
					headers: args.request ? args.request.headers : {},
					socket: (args.request && args.request.socket && args.request.socket._pixl_data) ? args.request.socket._pixl_data.id : '',
					stats: args.state,
					date: args.date,
					age: (Date.now() / 1000) - args.date
				});
				if (args.callback) {
					args.callback();
					delete args.callback;
				}
			} // foreach req
			
			for (var id in this.conns) {
				this.logDebug(4, "Closing HTTP connection: " + id);
				// this.conns[id].destroy();
				this.conns[id].end();
				this.conns[id].unref();
				this.numConns--;
			} // foreach conn
			
			this.http.close( function() { self.logDebug(3, "HTTP server has shut down."); } );
			
			if (this.https) {
				this.https.close( function() { self.logDebug(3, "HTTPS server has shut down."); } );
			}
			// delete this.http;
			
			this.requests = {};
			this.queue.kill();
		}
		
		callback();
	}
	
});
