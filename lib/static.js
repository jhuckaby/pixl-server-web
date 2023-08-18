// Simple HTTP / HTTPS Web Server
// A component for the pixl-server daemon framework.
// Copyright (c) 2015 - 2021 Joseph Huckaby
// Released under the MIT License

const fs = require('fs');
const Path = require('path');
const async = require('async');
const mime = require('mime');

module.exports = class Static {
	
	sendStaticResponse(args) {
		// serve static file for URI
		var self = this;
		var request = args.request;
		var response = args.response;
		var headers = {};
		
		// catch double-callback
		if (args.state == 'writing') {
			this.logError('write', "Warning: Double call to sendStaticResponse on same request detected.  Aborting second call.");
			return;
		}
		
		// convert URI to file path
		var file = '';
		if (args.internalFile) {
			file = args.internalFile;
			this.logDebug(9, "Serving static file for internal redirect: " + file);
		}
		else {
			var base_dir = Path.resolve( this.config.get('http_htdocs_dir') );
			file = Path.resolve( base_dir + request.url.replace(/\?.*$/, '').replace(/\/$/, '') );
			this.logDebug(9, "Serving static file for: " + args.request.url, { file });
			
			if (file.indexOf(base_dir) !== 0) {
				// trying to access file outside base -- just 404 it
				return self.sendHTTPResponse( args, 
					"404 Not Found", 
					{ 'Content-Type': "text/html" }, 
					"404 Not Found: " + request.url + "\n"
				);
			}
		}
		
		// determine format
		var http_status = "200 OK";
		var mime_type = mime.getType(file) || 'application/octet-stream';
		var file_stats = null;
		var is_dir = false;
		
		async.series([
			function(callback) {
				// first check if it's a directory, and if so, add /index.html
				fs.stat( file, function(err, stats) {
					if (err) return callback(err);
					file_stats = stats;
					
					if (stats.isDirectory()) {
						is_dir = true;
						file += '/' + self.config.get('http_static_index');
						mime_type = mime.getType(file) || 'application/octet-stream';
						self.logDebug(9, "Serving directory index: " + file);
						
						fs.stat( file, function(err, stats) {
							if (err) return callback(err);
							file_stats = stats;
							callback();
						}); // fs.stat
					}
					else callback();
				}); // fs.stat
			},
			function(callback) {
				// if mime is textish, check for gz file variant
				if (mime_type.match(self.regexTextContent) && request.headers['accept-encoding'] && request.headers['accept-encoding'].match(/\bgzip\b/i)) {
					var gz_file = file + '.gz';
					
					fs.stat( gz_file, function(err, stats) {
						if (err) return callback(); // non-fatal, fallback to non-gz
						
						// go for gz version
						file = gz_file;
						file_stats = stats;
						headers['Content-Encoding'] = 'gzip';
						self.logDebug(9, "Serving pre-gzipped version of file: " + file);
						callback();
					}); // fs.stat
				}
				else process.nextTick(callback);
			}
		],
		function(err) {
			if (err) {
				return self.sendHTTPResponse( args, 
					"404 Not Found", 
					{ 'Content-Type': "text/html" }, 
					"404 Not Found: " + request.url + "\n"
				);
			}
			
			// redirect for dir index without trailing slash
			if (is_dir && !request.url.match(/\/(\?|$)/)) {
				var new_url = self.getSelfURL( request, request.url.replace( /^(.+?)(\?.*)?$/, '$1/$2' ) );
				self.logDebug(9, "Redirecting for directory (adding trailing slash): " + new_url);
				return self.sendHTTPResponse( args, 
					"302 Found", 
					{ 'Location': new_url.replace(self.badHeaderCharPattern, '') }, 
					""
				);
			}
			
			// range request or nah
			var range = self.parseByteRange(request, file_stats);
			if (range) {
				headers['Content-Range'] = 'bytes ' + range.from + '-' + range.to + '/' + file_stats.size;
				http_status = "206 Partial Content";
				self.logDebug(9, "Serving partial file content: " + headers['Content-Range']);
			}
			else {
				range = { from: 0, to: file_stats.size - 1 };
			}
			
			// conditional get
			const file_mtime = file_stats.mtime.getTime();
			const file_etag = JSON.stringify([file_stats.ino, file_stats.size, file_mtime].join('-'));
			const req_etag = request.headers['if-none-match'];
			const req_mtime = Date.parse( request.headers['if-modified-since'] );
			
			if ((req_mtime || req_etag) && (!req_etag || (req_etag === file_etag)) && (!req_mtime || (req_mtime >= file_mtime))) {
				// file has not changed, send back 304
				return self.sendHTTPResponse( args, "304 Not Modified", {}, "" );
			}
			
			// standard headers
			headers['Etag'] = file_etag;
			headers['Last-Modified'] = (new Date(file_stats.mtime)).toUTCString();
			headers['Content-Type'] = mime_type;
			headers['Content-Length'] = (range.to - range.from) + 1;
			
			// cache-control
			var ttl = args.internalTTL || self.config.get('http_static_ttl') || 0;
			if (typeof(ttl) == 'number') headers['Cache-Control'] = "public, max-age=" + ttl;
			else headers['Cache-Control'] = ttl;
			
			// check for HEAD request
			if (request.method == 'HEAD') {
				return self.sendHTTPResponse( args, http_status, headers, "" );
			}
			
			// special response for 0-byte files
			if (!file_stats.size) {
				return self.sendHTTPResponse( args, http_status, headers, "" );
			}
			
			// open file stream
			var stream = fs.createReadStream( file, {
				start: range.from,
				end: range.to
			} );
			
			// send it
			self.sendHTTPResponse( args, http_status, headers, stream );
			
		}); // async.series
	}
	
	parseByteRange(req, stat) {
		// parse byte range header from request
		// Example header: Range: bytes=31-49
		const byteRange = {
			from: 0,
			to: 0
		}
		
		let rangeHeader = req.headers['range'];
		const flavor = 'bytes=';
		
		if (rangeHeader && rangeHeader.startsWith(flavor) && !rangeHeader.includes(',')) {
			// Parse
			rangeHeader = rangeHeader.substr(flavor.length).split('-');
			byteRange.from = parseInt(rangeHeader[0]);
			byteRange.to = parseInt(rangeHeader[1]);
			
			// Replace empty fields of differential requests by absolute values 
			if (isNaN(byteRange.from) && !isNaN(byteRange.to)) {
				byteRange.from = stat.size - byteRange.to;
				byteRange.to = stat.size ? stat.size - 1 : 0;
			} 
			else if (!isNaN(byteRange.from) && isNaN(byteRange.to)) {
				byteRange.to = stat.size ? stat.size - 1 : 0;
			}
			
			// General byte range validation
			if (!isNaN(byteRange.from) && !isNaN(byteRange.to) && (0 <= byteRange.from) && (byteRange.from <= byteRange.to) && (byteRange.to < stat.size)) {
				return byteRange;
			}
		}
		
		return null;
	}
	
};
