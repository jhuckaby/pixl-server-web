// Simple HTTP / HTTPS Web Server
// A component for the pixl-server daemon framework.
// Copyright (c) 2015 - 2021 Joseph Huckaby
// Released under the MIT License

const fs = require('fs');
const Path = require('path');
const ACL = require('pixl-acl');

module.exports = class Handlers {
	
	addURIFilter(uri, name, callback) {
		// add custom filter (chainable pre-handler) for URI
		this.logDebug(3, "Adding custom URI filter: " + uri + ": " + name);
		
		if (typeof(uri) == 'string') {
			uri = new RegExp("^" + uri + "$");
		}
		
		this.uriFilters.push({
			regexp: uri,
			name: name,
			callback: callback
		});
	}
	
	removeURIFilter(name) {
		// remove filter for URI given name
		this.uriFilters = this.uriFilters.filter( function(item) {
			return( item.name != name );
		} );
	}
	
	addURIHandler() {
		// add custom handler for URI
		// Calling conventions:
		//		uri, name, callback
		//		uri, name, acl, callback
		var self = this;
		var uri = arguments[0];
		var name = arguments[1];
		var acl = false;
		var callback = null;
		
		if (arguments.length == 4) { acl = arguments[2]; callback = arguments[3]; }
		else { callback = arguments[2]; }
		
		if (acl) {
			if (Array.isArray(acl)) {
				// custom ACL for this handler
				var blocks = new ACL();
				try {
					acl.forEach( function(block) {
						blocks.add( block );
					} );
					acl = blocks;
				}
				catch (err) {
					var err_msg = "Failed to initialize custom ACL: " + err.message;
					this.logError('acl', err_msg);
					throw new Error(err_msg);
				}
			}
			else {
				// use default ACL list
				acl = this.defaultACL;
			}
		} // acl
		
		this.logDebug(3, "Adding custom URI handler: " + uri + ": " + name);
		if (typeof(uri) == 'string') {
			uri = new RegExp("^" + uri + "$");
		}
		
		// special case: pass string as callback for internal file redirect
		if (typeof(callback) == 'string') {
			var target_file = callback;
			callback = function(args, cb) {
				self.logDebug(9, "Performing internal redirect to: " + target_file);
				args.internalFile = target_file;
				cb(false);
			};
		}
		
		this.uriHandlers.push({
			regexp: uri,
			name: name,
			acl: acl,
			callback: callback
		});
	}
	
	removeURIHandler(name) {
		// remove handler for URI given name
		this.uriHandlers = this.uriHandlers.filter( function(item) {
			return( item.name != name );
		} );
	}
	
	addMethodHandler(method, name, callback) {
		// add a handler for an entire request method, e.g. OPTIONS
		this.logDebug(3, "Adding custom request method handler: " + method + ": " + name);
		this.methodHandlers.push({
			method: method,
			name: name,
			callback: callback
		});
	}
	
	removeMethodHandler(name) {
		// remove handler for method given name
		this.methodHandlers = this.methodHandlers.filter( function(item) {
			return( item.name != name );
		} );
	}
	
	addDirectoryHandler(uri_match, base_path, opts) {
		// special URI handler that serves up a static directory
		// opts: { acl, ttl, headers }
		var self = this;
		if (!opts) opts = {};
		
		if (typeof(uri_match) == 'string') {
			// if string, assume is uri prefix
			uri_match = new RegExp("^" + uri_match);
		}
		
		this.addURIHandler(uri_match, "Static Directory: " + uri_match, opts.acl, function(args, callback) {
			var uri = args.request.url.replace(/\?.*$/, '');
			var file = Path.join( base_path, uri.replace(uri_match, '') ).replace(/\/$/, '');
			
			self.logDebug(9, "Routing static request for: " + uri, {
				base_path: base_path,
				file: file
			});
			
			if (opts.headers) {
				for (var key in opts.headers) {
					args.response.setHeader( key, opts.headers[key] );
				}
			}
			
			args.internalTTL = opts.ttl || 0;
			args.internalFile = file;
			callback(false);
		});
	}
	
	removeDirectoryHandler(uri_match) {
		// remove static directory handler by uri match specifier
		if (typeof(uri_match) == 'string') {
			// if string, assume is uri prefix
			uri_match = new RegExp("^" + uri_match);
		}
		this.removeURIHandler( "Static Directory: " + uri_match );
	}
	
};