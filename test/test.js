// Unit tests for pixl-server-web
// Copyright (c) 2017 - 2019 Joseph Huckaby
// Released under the MIT License

var Path = require('path');
var fs = require('fs');
var net = require('net');
var crypto = require('crypto');
var async = require('async');

var Class = require("pixl-class");
var PixlServer = require('pixl-server');

var PixlRequest = require('pixl-request');
var request = new PixlRequest();
request.setTimeout( 5 * 1000 ); // 5 seconds
request.setIdleTimeout( 5 * 1000 ); // 5 seconds

var http = require('http');
var agent_ka = new http.Agent({ keepAlive: true });
var agent_na = new http.Agent({ keepAlive: false });

process.chdir( __dirname );

var server = new PixlServer({
	
	__name: 'WebServerTest',
	__version: "1.0",
	
	config: {
		"log_dir": __dirname,
		"log_filename": "test.log",
		"debug_level": 9,
		"debug": 1,
		"echo": 0,
		
		"WebServer": {
			"http_port": 3020,
			"http_alt_ports": [3120],
			"http_htdocs_dir": __dirname,
			"http_max_upload_size": 1024 * 10,
			"http_static_ttl": 3600,
			"http_static_index": "index.html",
			"http_server_signature": "WebServerTest 1.0",
			"http_compress_text": 1,
			"http_enable_brotli": 1,
			"http_timeout": 5,
			"http_socket_prelim_timeout": 2,
			"http_response_headers": {
				"Via": "WebServerTest 1.0"
			},
			
			"http_log_requests": false,
			"http_regex_log": ".+",
			"http_recent_requests": 10,
			"http_max_connections": 10,
			
			"http_blacklist": ["5.6.7.0/24"],
			
			"http_rewrites": {
				"^/rewrite(.*)$": "/json$1"
			},
			"http_redirects": {
				"^/disney": "https://disney.com/",
				"^/pixar(.*)$": {
					"url": "https://pixar.com$1",
					"headers": { "X-Animal": "Frog" },
					"status": "301 Moved Permanently"
				}
			},
			
			"https": 1,
			"https_port": 3021,
			"https_alt_ports": [3121],
			"https_cert_file": "ssl.crt",
			"https_key_file": "ssl.key",
			"https_force": 0,
			"https_timeout": 5,
			"https_header_detect": {
				"Front-End-Https": "^on$",
				"X-Url-Scheme": "^https$",
				"X-Forwarded-Protocol": "^https$",
				"X-Forwarded-Proto": "^https$",
				"X-Forwarded-Ssl": "^on$"
			}
		}
	},
	
	components: [
		require('pixl-server-web')
	]
	
});

// Unit Tests

module.exports = {
	setUp: function (callback) {
		var self = this;
		this.server = server;
		
		// delete old unit test log
		fs.unlink( "test.log", function(err) {
			// startup mock server
			server.startup( function() {
				// startup complete
				var web_server = self.web_server = server.WebServer;
				
				// write log in sync mode, for troubleshooting
				server.logger.set('sync', true);
				
				web_server.addURIHandler( '/json', 'JSON Test', function(args, callback) {
					// send custom JSON response
					callback( {
						code: 0,
						description: "Success",
						user: { Name: "Joe", Email: "foo@bar.com" },
						params: args.params,
						query: args.query,
						cookies: args.cookies,
						files: args.files,
						headers: args.request.headers,
						socket_id: args.request.socket._pixl_data.id || 0,
						method: args.request.method,
						ip: args.ip,
						ips: args.ips
					} );
				} );
				
				web_server.addURIHandler( '/sleep', 'Sleep Test', function(args, callback) {
					// send custom JSON response
					var ms = parseInt( args.query.ms );
					
					setTimeout( function() {
						if (args.query.error) {
							callback( 
								"500 Internal Server Error", 
								{ 'X-Sleep': 1 },
								null
							);
						}
						else {
							callback( {
								code: 0,
								description: "Slept for " + ms + "ms",
								ms: ms
							} );
						}
					}, ms );
				} );
				
				web_server.addURIHandler( '/redirect', 'Redirect Test', function(args, callback) {
					// send custom redirect response
					callback( 
						"302 Found", 
						{ 'Location': web_server.getSelfURL(args.request, "/json?redirected=1") },
						null
					);
				} );
				
				web_server.addURIHandler( '/server-status', "Server Status", true, function(args, callback) {
					// send web stats (JSON), ACL protected endpoint
					callback( server.WebServer.getStats() );
				} );
				
				web_server.addURIHandler( '/binary-force-compress', 'Force Compress Test', function(args, callback) {
					// send custom compressed response
					callback( 
						"200 OK", 
						{ 'Content-Type': "image/gif", 'X-Compress': 1 },
						fs.readFileSync( 'spacer.gif' )
					);
				} );
				
				web_server.addDirectoryHandler( '/parentdir', Path.dirname(__dirname), { ttl: 25, headers: { 'X-Frogs': 'Toads' } } );
				
				// test suite ready
				callback();
				
			} ); // startup
		} ); // delete
	},
	
	tests: [
		
		function testSimpleRequest(test) {
			// test simple HTTP GET request to webserver backend
			request.json( 'http://127.0.0.1:3020/json', false,
				{
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					test.done();
				} 
			);
		},
		
		function testSimpleURLRewrite(test) {
			// test simple rewrite
			request.json( 'http://127.0.0.1:3020/rewrite', false,
				{
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					test.done();
				} 
			);
		},
		
		function testAdvancedURLRewrite(test) {
			// test advanced rewrite
			request.json( 'http://127.0.0.1:3020/rewrite?foo=bar1234&baz=bop%20pog&animal=frog&animal=dog', false,
				{
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					test.ok( !!json.query, "Found query object in JSON response" );
					test.ok( json.query.foo == "bar1234", "Query contains correct foo key" );
					test.ok( json.query.baz == "bop pog", "Query contains correct baz key (URL encoding)" );
					
					// dupes should become array by default
					test.ok( typeof(json.query.animal) == 'object', "Query param animal is an object" );
					test.ok( json.query.animal.length == 2, "Query param animal has length 2" );
					test.ok( json.query.animal[0] === 'frog', "First animal is frog" );
					test.ok( json.query.animal[1] === 'dog', "Second animal is dog" );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					test.done();
				} 
			);
		},
		
		function testSimpleURLRedirect(test) {
			// simple 302
			request.get( 'http://127.0.0.1:3020/disney',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 302, "Got 302 response: " + resp.statusCode );
					test.ok( !!resp.headers['location'], "Got Location header" );
					test.ok( !!resp.headers['location'].match(/disney\.com/), "Correct Location header");
					test.done();
				} 
			);
		},
		
		function testAdvancedURLRedirect(test) {
			// more complex redirect config (301, custom header)
			request.get( 'http://127.0.0.1:3020/pixar/toads',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 301, "Got 301 response: " + resp.statusCode );
					test.ok( !!resp.headers['location'], "Got Location header" );
					test.ok( !!resp.headers['location'].match(/pixar\.com\/toads/), "Correct Location header");
					test.ok( !!resp.headers['x-animal'], "Got x-animal header" );
					test.ok( !!resp.headers['x-animal'].match(/frog/i), "Correct x-animal header");
					test.done();
				} 
			);
		},
		
		function testHTTPAltPort(test) {
			// test simple HTTP GET request to webserver backend, alternate port
			request.json( 'http://127.0.0.1:3120/json', false,
				{
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					test.done();
				} 
			);
		},
		
		function testBadRequest(test) {
			// test bad HTTP GET request to webserver backend
			// this still resolves to the root dir index due to the ../
			request.get( 'http://127.0.0.1:3020/%0ASet-Cookie%3Acrlfinjection/../',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.done();
				} 
			);
		},
		
		// query string
		function testQueryString(test) {
			// test simple HTTP GET request with query string
			request.json( 'http://127.0.0.1:3020/json?foo=bar1234&baz=bop%20pog&animal=frog&animal=dog', false,
				{
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					test.ok( !!json.query, "Found query object in JSON response" );
					test.ok( json.query.foo == "bar1234", "Query contains correct foo key" );
					test.ok( json.query.baz == "bop pog", "Query contains correct baz key (URL encoding)" );
					
					// dupes should become array by default
					test.ok( typeof(json.query.animal) == 'object', "Query param animal is an object" );
					test.ok( json.query.animal.length == 2, "Query param animal has length 2" );
					test.ok( json.query.animal[0] === 'frog', "First animal is frog" );
					test.ok( json.query.animal[1] === 'dog', "Second animal is dog" );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					test.done();
				} 
			);
		},
		
		function testQueryStringFlatten(test) {
			// test simple HTTP GET request with query string dupes flattened
			var web = this.web_server;
			web.config.set('http_flatten_query', true);
			
			request.json( 'http://127.0.0.1:3020/json?foo=bar1234&baz=bop%20pog&animal=frog&animal=dog', false,
				{
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					test.ok( !!json.query, "Found query object in JSON response" );
					test.ok( json.query.foo == "bar1234", "Query contains correct foo key" );
					test.ok( json.query.baz == "bop pog", "Query contains correct baz key (URL encoding)" );
					
					test.ok( typeof(json.query.animal) == 'string', "Query param animal is a string" );
					test.ok( json.query.animal === 'dog', "Animal is dog" );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					// revert our hot config change
					web.config.set('http_flatten_query', false);
					
					test.done();
				} 
			);
		},
		
		// Cookies in request
		function testCookieRequest(test) {
			// test simple HTTP GET request with cookies
			request.json( 'http://127.0.0.1:3020/json', false,
				{
					headers: {
						'Cookie': "COOKIE1=foo1234; COOKIE2=bar=5678;",
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					test.ok( !!json.cookies, "Found cookies in JSON response" );
					test.ok( json.cookies.COOKIE1 == "foo1234", "Correct COOKIE1 value" );
					test.ok( json.cookies.COOKIE2 == "bar=5678", "Correct COOKIE2 value" );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					test.done();
				} 
			);
		},
		
		// Bad Cookies in request
		function testBadCookieRequest(test) {
			// test simple HTTP GET request with cookies
			request.json( 'http://127.0.0.1:3020/json', false,
				{
					headers: {
						'Cookie': "COOKIE1=foo1234; COOKIE2=bar5678%E0%A4%A;",
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					test.ok( !!json.cookies, "Found cookies in JSON response" );
					test.ok( json.cookies.COOKIE1 == "foo1234", "Correct COOKIE1 value" );
					test.ok( !json.cookies.COOKIE2, "Expected missing COOKIE2 value" );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					test.done();
				} 
			);
		},
		
		// HTTP POST (Standard)
		function testStandardPost(test) {
			request.post( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'X-Test': "Test"
					},
					data: {
						myparam: "foobar4567"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					// parse json in response
					var json = null;
					try { json = JSON.parse( data.toString() ); }
					catch (err) {
						test.ok( false, "Error parsing JSON: " + err );
						test.done();
					}
					
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.params, "Found params object in JSON response" );
					test.ok( json.params.myparam === "foobar4567", "Correct param in JSON response: " + json.params.myparam );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					test.done();
				} 
			);
		},
		
		// HTTP POST + File Upload
		function testMultipartPost(test) {
			request.post( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'X-Test': "Test"
					},
					multipart: true,
					data: {
						myparam: "foobar5678"
					},
					files: {
						file1: "spacer.gif"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					// parse json in response
					var json = null;
					try { json = JSON.parse( data.toString() ); }
					catch (err) {
						test.ok( false, "Error parsing JSON: " + err );
						test.done();
					}
					
					// test.debug( "JSON Response: ", json );
					
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.params, "Found params object in JSON response" );
					test.ok( json.params.myparam == "foobar5678", "Correct param in JSON response: " + json.params.myparam );
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					test.ok( !!json.files, "Found files object in JSON response" );
					test.ok( !!json.files.file1, "Found file1 object in JSON response" );
					
					// {"path":"/var/folders/11/r_0sz6s13cx1jn68l4m90zfr0000gn/T/40c1602ef5d90ed480edd3000.gif","type":"image/gif","name":"spacer.gif","size":43,"mtime":"2024-04-23T17:56:22.159Z"}
					var file1 = json.files.file1;
					test.ok( file1.size == 43, "Uploaded file has correct size (43): " + file1.size );
					test.ok( !!file1.path, "Uploaded file has no path" );
					test.ok( file1.type == 'image/gif', "Unexpected file type after upload: " + file1.type );
					test.ok( file1.name == 'spacer.gif', "Unexpected file name: " + file1.name );
					test.ok( !!file1.mtime, "Uploaded file has no mtime" );
					test.ok( !isNaN(Date.parse(file1.mtime)), "Invalid mtime in uploaded file: " + file1.mtime );
					
					test.done();
				}
			);
		},
		
		// JSON POST
		function testJSONPOST(test) {
			// test JSON HTTP POST request to webserver backend
			request.json( 'http://127.0.0.1:3020/json', { foo: 'barpost' },
				{
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.debug( "JSON Response", json );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					
					test.ok( !!json.params, "Found params object in JSON response" );
					test.ok( json.params.foo == "barpost", "Correct param in JSON response: " + json.params.foo );
					
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					test.done();
				} 
			);
		},
		
		// HTTP PUT
		function testStandardPut(test) {
			request.put( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					// parse json in response
					var json = null;
					try { json = JSON.parse( data.toString() ); }
					catch (err) {
						test.ok( false, "Error parsing JSON: " + err );
						test.done();
					}
					
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					// make sure echoed request method is correct
					test.ok( json.method == "PUT", "Request method is incorrect: " + json.method + " (expected PUT)" );
					
					test.done();
				} 
			);
		},
		
		// HTTP PUT with request body
		function testStandardPutWithData(test) {
			request.put( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'X-Test': "Test"
					},
					data: {
						myparam: "foobar4567"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					// parse json in response
					var json = null;
					try { json = JSON.parse( data.toString() ); }
					catch (err) {
						test.ok( false, "Error parsing JSON: " + err );
						test.done();
					}
					
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.params, "Found params object in JSON response" );
					test.ok( json.params.myparam == "foobar4567", "Correct param in JSON response: " + json.params.myparam );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					// make sure echoed request method is correct
					test.ok( json.method == "PUT", "Request method is incorrect: " + json.method + " (expected PUT)" );
					
					test.done();
				} 
			);
		},
		
		// JSON HTTP PUT
		function testJSONPut(test) {
			// test simple JSON HTTP PUT request to webserver backend
			request.json( 'http://127.0.0.1:3020/json', false,
				{
					method: "PUT",
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					// make sure echoed request method is correct
					test.ok( json.method == "PUT", "Request method is incorrect: " + json.method + " (expected PUT)" );
					
					test.done();
				} 
			);
		},
		
		// JSON HTTP PUT with request body
		function testJSONPutWithData(test) {
			// test simple JSON HTTP PUT request to webserver backend
			request.json( 'http://127.0.0.1:3020/json', { myparam: "foobar4567" },
				{
					method: "PUT",
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					// request content is echoed too
					test.ok( !!json.params, "Found params object in JSON response" );
					test.ok( json.params.myparam == "foobar4567", "Correct param in JSON response: " + json.params.myparam );
					
					// make sure echoed request method is correct
					test.ok( json.method == "PUT", "Request method is incorrect: " + json.method + " (expected PUT)" );
					
					test.done();
				} 
			);
		},
		
		// HTTP DELETE
		function testStandardDelete(test) {
			request.delete( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					// parse json in response
					var json = null;
					try { json = JSON.parse( data.toString() ); }
					catch (err) {
						test.ok( false, "Error parsing JSON: " + err );
						test.done();
					}
					
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					// make sure echoed request method is correct
					test.ok( json.method == "DELETE", "Request method is incorrect: " + json.method + " (expected DELETE)" );
					
					test.done();
				} 
			);
		},
		
		// HTTP DELETE with request body
		function testStandardDeleteWithData(test) {
			request.delete( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'X-Test': "Test"
					},
					data: {
						myparam: "foobar4567"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					// parse json in response
					var json = null;
					try { json = JSON.parse( data.toString() ); }
					catch (err) {
						test.ok( false, "Error parsing JSON: " + err );
						test.done();
					}
					
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.params, "Found params object in JSON response" );
					test.ok( json.params.myparam == "foobar4567", "Correct param in JSON response: " + json.params.myparam );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					// make sure echoed request method is correct
					test.ok( json.method == "DELETE", "Request method is incorrect: " + json.method + " (expected DELETE)" );
					
					test.done();
				} 
			);
		},
		
		// JSON HTTP DELETE
		function testJSONDelete(test) {
			// test simple JSON HTTP DELETE request to webserver backend
			request.json( 'http://127.0.0.1:3020/json', false,
				{
					method: "DELETE",
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					// make sure echoed request method is correct
					test.ok( json.method == "DELETE", "Request method is incorrect: " + json.method + " (expected DELETE)" );
					
					test.done();
				} 
			);
		},
		
		// JSON HTTP DELETE with request body
		function testJSONDeleteWithData(test) {
			// test simple JSON HTTP DELETE request to webserver backend
			request.json( 'http://127.0.0.1:3020/json', { myparam: "foobar4567" },
				{
					method: "DELETE",
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					test.ok( !!json.params, "Found params object in JSON response" );
					test.ok( json.params.myparam == "foobar4567", "Correct param in JSON response: " + json.params.myparam );
					
					// make sure echoed request method is correct
					test.ok( json.method == "DELETE", "Request method is incorrect: " + json.method + " (expected DELETE)" );
					
					test.done();
				} 
			);
		},
		
		// HTTP HEAD
		function testStandardHead(test) {
			request.head( 'http://127.0.0.1:3020/spacer.gif',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( !!resp.headers['content-type'], "Content-Type header present" );
					test.ok( !!resp.headers['content-type'].match(/image\/gif/), "Content-Type header contains correct value" );
					
					test.ok( !!resp.headers['cache-control'], "Cache-Control header present" );
					test.ok( !!resp.headers['cache-control'].match(/max\-age\=3600/), "Cache-Control header contains correct TTL" );
					
					test.ok( !resp.headers['content-encoding'], "Content-Encoding header should NOT be present for a GIF!" );
					test.ok( resp.headers['content-length'] == 43, "spacer.gif is not 43 bytes as expected: " + resp.headers['content-length'] );
					
					test.ok( !!data, "No data object present in HEAD response" );
					test.ok( data.length == 0, "Non-zero data length in HEAD response: " + data.length );
					
					test.done();
				} 
			);
		},
		
		// Error (404)
		function testFileNotFound(test) {
			request.get( 'http://127.0.0.1:3020/noexist',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 404, "Got 404 response: " + resp.statusCode );
					test.done();
				} 
			);
		},
		
		// Error (Front-end Timeout)
		function testFrontEndTimeout(test) {
			request.get( 'http://127.0.0.1:3020/sleep?ms=750',
				{
					timeout: 500
				},
				function(err, resp, data, perf) {
					test.ok( !!err, "Got error from PixlRequest" );
					test.ok( err.toString().match(/timeout|timed out/i), "Correct error message: " + err );
					test.done();
				} 
			);
		},
		
		// Error (Back-end Timeout)
		function testBackEndTimeout(test) {
			var self = this;
			var web = this.web_server;
			web.config.set('http_request_timeout', 0.5); // 500ms
			
			request.get( 'http://127.0.0.1:3020/sleep?ms=750', {},
				function(err, resp, data, perf) {
					web.config.set('http_request_timeout', 0); // reset timeout
					test.ok( !err, "Unexpected error from PixlRequest: " + err );
					test.ok( resp.statusCode == 408, "Unexpected HTTP response code: " + resp.statusCode );
					test.done();
				} 
			);
		},
		
		// static file get
		// check ttl, check gzip
		function testStaticTextRequest(test) {
			// test simple HTTP GET to webserver backend
			request.get( 'http://127.0.0.1:3020/index.html',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					test.ok( !!resp.headers['content-type'], "Content-Type header present" );
					test.ok( !!resp.headers['content-type'].match(/text\/html/), "Content-Type header contains correct value" );
					
					test.ok( !!resp.headers['cache-control'], "Cache-Control header present" );
					test.ok( !!resp.headers['cache-control'].match(/max\-age\=3600/), "Cache-Control header contains correct TTL" );
					
					test.ok( !!resp.headers['content-encoding'], "Content-Encoding header present" );
					test.ok( !!resp.headers['content-encoding'].match(/gzip/), "Content-Encoding header contains gzip" );
					
					test.ok( !!data, "Got HTML in response" );
					test.ok( data.toString() === fs.readFileSync('index.html', 'utf8'), "index.html content is correct" );
					
					test.done();
				} 
			);
		},
		
		// static file get
		// this file is not pre-gzipped, so web server should do it in real time
		// this will use brotli
		function testStaticTextRequest2(test) {
			// test simple HTTP GET to webserver backend
			request.get( 'http://127.0.0.1:3020/robots.txt',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					test.ok( !!resp.headers['content-type'], "Content-Type header present" );
					test.ok( !!resp.headers['content-type'].match(/text\/plain/), "Content-Type header contains correct value" );
					
					test.ok( !!resp.headers['cache-control'], "Cache-Control header present" );
					test.ok( !!resp.headers['cache-control'].match(/max\-age\=3600/), "Cache-Control header contains correct TTL" );
					
					test.ok( !!resp.headers['content-encoding'], "Content-Encoding header present" );
					test.ok( !!resp.headers['content-encoding'].match(/br/), "Content-Encoding header contains br" );
					
					test.ok( !!data, "Got text in response" );
					test.ok( data.toString() === fs.readFileSync('robots.txt', 'utf8'), "robots.txt content is correct" );
					
					test.done();
				} 
			);
		},
		
		// binary get
		// should NOT be gzip encoded
		function testStaticBinaryRequest(test) {
			// test simple HTTP GET to webserver backend
			request.get( 'http://127.0.0.1:3020/spacer.gif',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					test.ok( !!resp.headers['content-type'], "Content-Type header present" );
					test.ok( !!resp.headers['content-type'].match(/image\/gif/), "Content-Type header contains correct value" );
					
					test.ok( !!resp.headers['cache-control'], "Cache-Control header present" );
					test.ok( !!resp.headers['cache-control'].match(/max\-age\=3600/), "Cache-Control header contains correct TTL" );
					
					test.ok( !resp.headers['content-encoding'], "Content-Encoding header should NOT be present!" );
					
					test.ok( !!data, "Got data in response" );
					
					test.done();
				} 
			);
		},
		
		// static range request
		function testStaticRangeRequest(test) {
			// test ranged HTTP GET to webserver backend
			var opts = {
				headers: {
					'Accept-Encoding': 'none',
					'Range': 'bytes=31-49'
				}
			};
			request.get( 'http://127.0.0.1:3020/index.html', opts,
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 206, "Got 206 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					test.ok( !!resp.headers['content-type'], "Content-Type header present" );
					test.ok( !!resp.headers['content-type'].match(/text\/html/), "Content-Type header contains correct value" );
					
					test.ok( !!resp.headers['cache-control'], "Cache-Control header present" );
					test.ok( !!resp.headers['cache-control'].match(/max\-age\=3600/), "Cache-Control header contains correct TTL" );
					
					test.ok( !resp.headers['content-encoding'], "Content-Encoding header not present" );
					
					test.ok( !!data, "Got HTML in response" );
					test.ok( data.toString() === '<title>Test</title>', "index.html range snippet is correct: >>>" + data.toString() + "<<<" );
					
					test.done();
				} 
			);
		},
		
		// invalid range request
		function testStaticInvalidRangeRequest(test) {
			// test simple HTTP GET to webserver backend
			var opts = {
				headers: {
					'Accept-Encoding': 'none',
					'Range': 'bytes=1-0'
				}
			};
			request.get( 'http://127.0.0.1:3020/index.html', opts,
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					test.ok( !!resp.headers['content-type'], "Content-Type header present" );
					test.ok( !!resp.headers['content-type'].match(/text\/html/), "Content-Type header contains correct value" );
					
					test.ok( !!resp.headers['cache-control'], "Cache-Control header present" );
					test.ok( !!resp.headers['cache-control'].match(/max\-age\=3600/), "Cache-Control header contains correct TTL" );
					
					test.ok( !resp.headers['content-encoding'], "Content-Encoding header not present" );
					
					// invalid range will fallback to entire file
					test.ok( !!data, "Got HTML in response" );
					test.ok( data.toString() === fs.readFileSync('index.html', 'utf8'), "index.html content is correct" );
					
					test.done();
				} 
			);
		},
		
		// static directory request
		function testStaticDirectoryRequest(test) {
			// test simple HTTP GET to webserver backend
			request.get( 'http://127.0.0.1:3020/',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					test.ok( !!resp.headers['content-type'], "Content-Type header present" );
					test.ok( !!resp.headers['content-type'].match(/text\/html/), "Content-Type header contains correct value" );
					
					test.ok( !!resp.headers['cache-control'], "Cache-Control header present" );
					test.ok( !!resp.headers['cache-control'].match(/max\-age\=3600/), "Cache-Control header contains correct TTL" );
					
					// Note: this is gzip (and not brotli) because of the pre-gzipped static file (index.html.gz)
					test.ok( !!resp.headers['content-encoding'], "Content-Encoding header present" );
					test.ok( !!resp.headers['content-encoding'].match(/gzip/), "Content-Encoding header contains gzip" );
					
					test.ok( !!data, "Got HTML in response" );
					test.ok( data.toString() === fs.readFileSync('index.html', 'utf8'), "index.html content is correct" );
					
					test.done();
				} 
			);
		},
		
		// custom static dir
		function testCustomStaticRequest(test) {
			// test simple HTTP GET to webserver backend
			request.get( 'http://127.0.0.1:3020/parentdir/package.json',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( resp.headers['x-frogs'] == "Toads", "Correct X-Frogs header: " + resp.headers['x-frogs'] );
					
					test.ok( !!resp.headers['content-type'], "Content-Type header present" );
					test.ok( !!resp.headers['content-type'].match(/application\/json/), "Content-Type header contains correct value" );
					
					test.ok( !!resp.headers['cache-control'], "Cache-Control header present" );
					test.ok( !!resp.headers['cache-control'].match(/max\-age\=25/), "Cache-Control header contains correct TTL" );
					
					test.ok( !!resp.headers['content-encoding'], "Content-Encoding header present" );
					test.ok( !!resp.headers['content-encoding'].match(/\bbr\b/), "Content-Encoding header contains br" );
					
					test.ok( !!data, "Got JSON in response" );
					test.ok( data.toString() === fs.readFileSync('../package.json', 'utf8'), "package.json content is correct" );
					
					test.done();
				} 
			);
		},
		
		function testCustomStaticDirectoryRequest(test) {
			// test simple HTTP GET to webserver backend
			request.get( 'http://127.0.0.1:3020/parentdir/test/',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( resp.headers['x-frogs'] == "Toads", "Correct X-Frogs header: " + resp.headers['x-frogs'] );
					
					test.ok( !!resp.headers['content-type'], "Content-Type header present (custom)" );
					test.ok( !!resp.headers['content-type'].match(/text\/html/), "Content-Type header contains correct value (custom)" );
					
					test.ok( !!resp.headers['cache-control'], "Cache-Control header present (custom)" );
					test.ok( !!resp.headers['cache-control'].match(/max\-age\=25/), "Cache-Control header contains correct TTL (custom)" );
					
					// Note: this is gzip (and not brotli) because of the pre-gzipped static file (index.html.gz)
					test.ok( !!resp.headers['content-encoding'], "Content-Encoding header present (custom)" );
					test.ok( !!resp.headers['content-encoding'].match(/gzip/), "Content-Encoding header contains gzip (custom)" );
					
					test.ok( !!data, "Got HTML in response (custom)" );
					test.ok( data.toString() === fs.readFileSync('index.html', 'utf8'), "index.html content is correct (custom)" );
					
					test.done();
				} 
			);
		},
		
		function testCustomStaticDirectoryRedirect(test) {
			// test simple HTTP GET to webserver backend
			request.get( 'http://127.0.0.1:3020/parentdir/test',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 302, "Got 302 response: " + resp.statusCode );
					
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( resp.headers['x-frogs'] == "Toads", "Correct X-Frogs header: " + resp.headers['x-frogs'] );
					
					test.ok( !!resp.headers['location'], "Location header present (custom)" );
					test.ok( !!resp.headers['location'].match(/\/parentdir\/test\//), "Location header contains correct value (custom)" );
					
					test.done();
				} 
			);
		},
		
		// binary force compress
		// this is a binary file (typically not compressed), but the handler is forcing compression
		function testBinaryForceCompress(test) {
			// test HTTP GET to webserver backend, make sure response is compressed
			request.get( 'http://127.0.0.1:3020/binary-force-compress',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					test.ok( !!resp.headers['content-type'], "Content-Type header present" );
					test.ok( !!resp.headers['content-type'].match(/image\/gif/), "Content-Type header contains correct value" );
					
					test.ok( !!resp.headers['content-encoding'], "Content-Encoding header present" );
					test.ok( !!resp.headers['content-encoding'].match(/\b(deflate|gzip|br)\b/), "Content-Encoding header contains appropriate value" );
					
					test.ok( !!data, "Got data in response" );
					test.ok( data.length === fs.readFileSync('spacer.gif').length, "spacer.gif content is correct" );
					
					test.done();
				} 
			);
		},
		
		// no encoding
		function testNoEncoding(test) {
			// test simple HTTP GET to webserver backend
			// do not accept any encoding from client side
			request.get( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'Accept-Encoding': "none"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					test.ok( !!resp.headers['content-type'], "Content-Type header present" );
					test.ok( !!resp.headers['content-type'].match(/json/), "Content-Type header contains correct value" );
					
					test.ok( !resp.headers['content-encoding'], "Content-Encoding header should NOT be present!" );
					
					test.ok( !!data, "Got data in response" );
					test.ok( !!data.length, "Data has non-zero length" );
					test.done();
				} 
			);
		},
		
		// deflate encoding
		function testDeflateEncoding(test) {
			// test simple HTTP GET to webserver backend
			// only accept deflate encoding from client side
			request.get( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'Accept-Encoding': "deflate"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					test.ok( !!resp.headers['content-type'], "Content-Type header present" );
					test.ok( !!resp.headers['content-type'].match(/json/), "Content-Type header contains correct value" );
					
					test.ok( !!resp.headers['content-encoding'], "Content-Encoding header present" );
					test.ok( !!resp.headers['content-encoding'].match(/\b(deflate)\b/), "Content-Encoding header contains deflate" );
					
					test.ok( !!data, "Got data in response" );
					test.ok( !!data.length, "Data has non-zero length" );
					test.done();
				} 
			);
		},
		
		// gzip encoding
		function testGzipEncoding(test) {
			// test simple HTTP GET to webserver backend
			// only accept gzip encoding from client side
			request.get( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'Accept-Encoding': "gzip"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					test.ok( !!resp.headers['content-type'], "Content-Type header present" );
					test.ok( !!resp.headers['content-type'].match(/json/), "Content-Type header contains correct value" );
					
					test.ok( !!resp.headers['content-encoding'], "Content-Encoding header present" );
					test.ok( !!resp.headers['content-encoding'].match(/\b(gzip)\b/), "Content-Encoding header contains gzip" );
					
					test.ok( !!data, "Got data in response" );
					test.ok( !!data.length, "Data has non-zero length" );
					test.done();
				} 
			);
		},
		
		// brotli encoding
		function testBrotliEncoding(test) {
			// test simple HTTP GET to webserver backend
			// only accept brotli encoding from client side
			request.get( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'Accept-Encoding': "br"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					test.ok( !!resp.headers['content-type'], "Content-Type header present" );
					test.ok( !!resp.headers['content-type'].match(/json/), "Content-Type header contains correct value" );
					
					test.ok( !!resp.headers['content-encoding'], "Content-Encoding header present" );
					test.ok( !!resp.headers['content-encoding'].match(/\b(br)\b/), "Content-Encoding header contains br" );
					
					test.ok( !!data, "Got data in response" );
					test.ok( !!data.length, "Data has non-zero length" );
					test.done();
				} 
			);
		},
		
		// socket prelim timeout
		function testSocketPrelimTimeout(test) {
			var connected_time = 0;
			var client = net.connect({ port: 3020 }, function() {
				test.debug("Connected to port 3020 (raw socket)");
				connected_time = Date.now() / 1000;
			});
			client.on('data', function(data) {
				test.ok( false, "Should NOT have received any data from socket! " + data );
			});
			client.on('end', function() {
				test.debug("Raw socket disconnected");
				var now = Date.now() / 1000;
				var elapsed = now - connected_time;
				test.ok( Math.abs(elapsed - 2.0) < 1.0, "Incorrect time elapsed for socket prelim timeout: " + elapsed );
				test.done();
			});
		},
		
		function waitForAllSockets(test) {
			// wait for all sockets to close for next test (requires clean slate)
			var self = this;
			
			test.debug("Connections still open: ", Object.keys(self.web_server.conns) );
			
			for (var id in this.web_server.conns) {
				this.web_server.conns[id].end();
			}
			
			async.whilst(
				function(cb) { 
					cb( null, Object.keys(self.web_server.conns).length > 0 );
				},
				function(callback) {
					setTimeout( function() { callback(); }, 100 );
				},
				function() {
					test.done();
				}
			); // async.whilst
		},
		
		// http_max_connections
		function testMaxConnections(test) {
			// test going over max concurrent connections (10)
			// this test is very perf and timing sensitive, may fail on overloaded or underpowered servers
			// we need ALL sockets to be closed for this
			var self = this;
			
			test.ok( Object.keys(self.web_server.conns).length == 0, "Oops, there's one or more sockets left" );
			
			// open 10 concurrent
			for (var idx = 0; idx < 10; idx++) {
				request.get( 'http://127.0.0.1:3020/sleep?ms=500',
					function(err, resp, data, perf) {
						// ignore
					} 
				);
			} // loop
			
			// sleep for 250ms, then test
			setTimeout( function() {
				// now, all 10 requests should be in progress, so 11th should fail
				request.get( 'http://127.0.0.1:3020/json',
					function(err, resp, data, perf) {
						test.ok( !!err, "Expected error from PixlRequest" );
						setTimeout( function() { test.done(); }, 500 ); // wait for all 10 to complete
					} 
				);
			}, 250 );
		},
		
		// post size too large
		function testLargeMultipartPost(test) {
			request.post( 'http://127.0.0.1:3020/json',
				{
					multipart: true,
					data: {
						myparam: crypto.randomBytes( (1024 * 10) + 1 )
					}
				},
				function(err, resp, data, perf) {
					// multi-part relies on 'formidable' to throw an error, so it is a HTTP 400
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 400, "Got 400 response: " + resp.statusCode );
					test.done();
				} 
			);
		},
		function testLargeRawPost(test) {
			request.post( 'http://127.0.0.1:3020/json',
				{
					headers: {
						'Content-Type': "application/octet-stream"
					},
					data: crypto.randomBytes( (1024 * 10) + 1 )
				},
				function(err, resp, data, perf) {
					// pure post generates a socket-closing super error
					test.ok( !!err, "Expected error from PixlRequest" );
					test.done();
				} 
			);
		},
		
		// keep-alives
		function testKeepAlives(test) {
			// test keep-alive sockets
			var sendReqGetSocketID = function(ka, callback) {
				request.json( 'http://127.0.0.1:3020/json', false, { agent: ka ? agent_ka : agent_na },
					function(err, resp, json, perf) {
						if (err && !json && !json.socket_id) return callback(false);
						callback( json.socket_id );
					} 
				); // request.json
			}; // sendReqGetSocketID
			
			sendReqGetSocketID( false, function(socket1) {
				test.ok( !!socket1, "Got Socket ID 1 (close)" );
				
				sendReqGetSocketID( false, function(socket2) {
					test.ok( !!socket2, "Got Socket ID 2 (close)" );
					
					test.ok( socket1 != socket2, "Socket IDs differ with close" );
					
					// now try it again with KA
					sendReqGetSocketID( true, function(socket3) {
						test.ok( !!socket3, "Got Socket ID 3 (KA)" );
						
						sendReqGetSocketID( true, function(socket4) {
							test.ok( !!socket4, "Got Socket ID 4 (KA)" );
							
							test.ok( socket3 == socket4, "Socket IDs same with KA" );
							test.done();
							
						} ); // req 4
					} ); // req 3
				} ); // req 2
			} ); // req 1
		},
		
		// redirect
		function testRedirectHandler(test) {
			request.get( 'http://127.0.0.1:3020/redirect',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 302, "Got 302 response: " + resp.statusCode );
					test.ok( !!resp.headers['location'], "Got Location header" );
					test.ok( !!resp.headers['location'].match(/redirected/), "Correct Location header");
					test.done();
				} 
			);
		},
		
		// x-forwarded-for
		function testForwardedFor(test) {
			request.json( 'http://127.0.0.1:3020/json', false, 
				{
					headers: {
						"X-Forwarded-For": "1.2.3.4" // external IP
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( data.ip === "1.2.3.4", "Correct Public IP in response: " + data.ip );
					test.done();
				} 
			);
		},
		function testForwardedForGarbage(test) {
			request.json( 'http://127.0.0.1:3020/json', false, 
				{
					headers: {
						"X-Forwarded-For": "garbage, 1.2.3.4, more garbage" // external IP
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( data.ip === "1.2.3.4", "Correct Public IP in response: " + data.ip );
					test.done();
				} 
			);
		},
		function testForwardedForAllGarbage(test) {
			request.json( 'http://127.0.0.1:3020/json', false, 
				{
					headers: {
						"X-Forwarded-For": "garbage" // external IP
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( data.ip === "127.0.0.1", "Correct Public IP in response: " + data.ip );
					test.done();
				} 
			);
		},
		
		// http_public_ip_offset
		function testForwardedForOffsetNeg1(test) {
			var self = this;
			var web = this.web_server;
			web.config.set('http_public_ip_offset', -1);
			
			request.json( 'http://127.0.0.1:3020/json', false, 
				{
					headers: {
						"X-Forwarded-For": "1.2.3.4, 2.3.4.5, 3.4.5.6"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( data.ip === "127.0.0.1", "Correct offset public IP in response: " + data.ip );
					web.config.set('http_public_ip_offset', 0); // reset
					test.done();
				} 
			);
		},
		function testForwardedForOffsetNeg2(test) {
			var self = this;
			var web = this.web_server;
			web.config.set('http_public_ip_offset', -2);
			
			request.json( 'http://127.0.0.1:3020/json', false, 
				{
					headers: {
						"X-Forwarded-For": "1.2.3.4, 2.3.4.5, 3.4.5.6"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( data.ip === "3.4.5.6", "Correct offset public IP in response: " + data.ip );
					web.config.set('http_public_ip_offset', 0); // reset
					test.done();
				} 
			);
		},
		function testForwardedForOffsetNeg3(test) {
			var self = this;
			var web = this.web_server;
			web.config.set('http_public_ip_offset', -3);
			
			request.json( 'http://127.0.0.1:3020/json', false, 
				{
					headers: {
						"X-Forwarded-For": "1.2.3.4, 2.3.4.5, 3.4.5.6"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( data.ip === "2.3.4.5", "Correct offset public IP in response: " + data.ip );
					web.config.set('http_public_ip_offset', 0); // reset
					test.done();
				} 
			);
		},
		
		// acl block
		function testACL(test) {
			request.get( 'http://127.0.0.1:3020/server-status', // ACL'ed endpoint
				{
					headers: {
						"X-Forwarded-For": "1.2.3.4" // external IP
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 403, "Got 403 response: " + resp.statusCode );
					test.done();
				} 
			);
		},
		
		function testACLBadIP(test) {
			// test badly-formatted IP
			request.get( 'http://127.0.0.1:3020/server-status', // ACL'ed endpoint
				{
					headers: {
						"X-Forwarded-For": "THIS-IS-NOT-AN-IP-ADDRESS" // external IP
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 403, "Got 403 response: " + resp.statusCode );
					test.done();
				} 
			);
		},
		
		// blacklist
		function testBlacklistedIP(test) {
			request.get( 'http://127.0.0.1:3020/json', 
				{
					headers: {
						"X-Forwarded-For": "5.6.7.8" // blacklisted
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 403, "Got 403 response: " + resp.statusCode );
					test.done();
				} 
			);
		},
		function testAnotherBlacklistedIP(test) {
			request.get( 'http://127.0.0.1:3020/json', 
				{
					headers: {
						"X-Forwarded-For": "1.2.3.4, 5.6.7.255, 2.3.4.5" // blacklisted
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 403, "Got 403 response: " + resp.statusCode );
					test.done();
				} 
			);
		},
		function testAllowedIP(test) {
			request.get( 'http://127.0.0.1:3020/json', 
				{
					headers: {
						"X-Forwarded-For": "5.6.8.7" // just outside blacklisted range
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.done();
				} 
			);
		},
		
		function testConditionalResponseHeaders(test) {
			// test response headers per http code
			var self = this;
			var web = this.web_server;
			
			web.config.set('http_code_response_headers', {
				"403": { 'X-Test-Cond': "Tree Frogs" }
			});
			
			request.get( 'http://127.0.0.1:3020/server-status', // ACL'ed endpoint
				{
					headers: {
						"X-Forwarded-For": "1.2.3.4" // external IP
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 403, "Got 403 response: " + resp.statusCode );
					test.ok( resp.headers['x-test-cond'] === "Tree Frogs", "Unexpected header: " + resp.headers['X-Test-Cond'] );
					
					// make sure basic 200 doesn't have header
					request.json( 'http://127.0.0.1:3020/json', false, {}, 
						function(err, resp, json, perf) {
							test.ok( !err, "No error from PixlRequest: " + err );
							test.ok( !!resp, "Got resp from PixlRequest" );
							test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
							test.ok( !resp.headers['x-test-cond'], "Unexpected X-Test-Cond header for HTTP 200!" );
							web.config.set('http_code_response_headers', null); // reset config
							test.done();
						}
					);
				} 
			);
		},
		
		// get stats
		function testStats(test) {
			// test stats API (this also tests ACL pass)
			request.json( 'http://127.0.0.1:3020/server-status', false,
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					
					// test.debug("Web Server Stats", json);
					test.ok( !!json.server, "server obj in stats" );
					test.ok( json.server.name == "WebServerTest", "Correct server name in stats" );
					test.ok( !!json.stats, "stats present" );
					test.ok( !!json.stats.total, "total in stats" );
					test.ok( !!json.sockets, "sockets in stats" );
					test.ok( Object.keys(json.sockets).length == 2, "Exactly 2 active sockets" );
					test.ok( !!json.recent, "recent in stats" );
					test.ok( json.recent.length > 0, "recent has length" );
					
					test.done();
				} 
			);
		},
		
		// https
		function testHTTPSRequest(test) {
			// test HTTPS GET request to webserver backend
			request.json( 'https://127.0.0.1:3021/json', false,
				{
					rejectUnauthorized: false, // self-signed cert
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					test.ok( !!json.headers.ssl, "SSL pseudo-header present in echo" );
					
					test.done();
				} 
			);
		},
		
		function testHTTPSAltPort(test) {
			// test HTTPS GET request to webserver backend on alt port
			request.json( 'https://127.0.0.1:3121/json', false,
				{
					rejectUnauthorized: false, // self-signed cert
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					test.ok( !!json.headers.ssl, "SSL pseudo-header present in echo" );
					
					test.done();
				} 
			);
		},
		
		function testHTTPSPost(test) {
			request.post( 'https://127.0.0.1:3021/json',
				{
					rejectUnauthorized: false, // self-signed cert
					headers: {
						'X-Test': "Test"
					},
					data: {
						myparam: "foobar4567"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					// parse json in response
					var json = null;
					try { json = JSON.parse( data.toString() ); }
					catch (err) {
						test.ok( false, "Error parsing JSON: " + err );
						test.done();
					}
					
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.params, "Found params object in JSON response" );
					test.ok( json.params.myparam === "foobar4567", "Correct param in JSON response: " + json.params.myparam );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					test.ok( !!json.headers.ssl, "SSL pseudo-header present in echo" );
					
					test.done();
				} 
			);
		},
		
		// HTTPS POST + File Upload
		function testHTTPSMultipartPost(test) {
			request.post( 'https://127.0.0.1:3021/json',
				{
					rejectUnauthorized: false, // self-signed cert
					headers: {
						'X-Test': "Test"
					},
					multipart: true,
					data: {
						myparam: "foobar5678"
					},
					files: {
						file1: "spacer.gif"
					}
				},
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					
					// parse json in response
					var json = null;
					try { json = JSON.parse( data.toString() ); }
					catch (err) {
						test.ok( false, "Error parsing JSON: " + err );
						test.done();
					}
					
					// test.debug( "JSON Response: ", json );
					
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.params, "Found params object in JSON response" );
					test.ok( json.params.myparam == "foobar5678", "Correct param in JSON response: " + json.params.myparam );
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					test.ok( !!json.headers.ssl, "SSL pseudo-header present in echo" );
					test.ok( !!json.files, "Found files object in JSON response" );
					test.ok( !!json.files.file1, "Found file1 object in JSON response" );
					
					// {"path":"/var/folders/11/r_0sz6s13cx1jn68l4m90zfr0000gn/T/40c1602ef5d90ed480edd3000.gif","type":"image/gif","name":"spacer.gif","size":43,"mtime":"2024-04-23T17:56:22.159Z"}
					var file1 = json.files.file1;
					test.ok( file1.size == 43, "Uploaded file has correct size (43): " + file1.size );
					test.ok( !!file1.path, "Uploaded file has no path" );
					test.ok( file1.type == 'image/gif', "Unexpected file type after upload: " + file1.type );
					test.ok( file1.name == 'spacer.gif', "Unexpected file name: " + file1.name );
					test.ok( !!file1.mtime, "Uploaded file has no mtime" );
					test.ok( !isNaN(Date.parse(file1.mtime)), "Invalid mtime in uploaded file: " + file1.mtime );
					
					test.done();
				} 
			);
		},
		
		// SSL JSON POST
		function testHTTPSJSONPOST(test) {
			// test JSON HTTPS POST request to webserver backend
			request.json( 'https://127.0.0.1:3021/json', { foo: 'barpost' },
				{
					rejectUnauthorized: false, // self-signed cert
					headers: {
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.debug( "JSON Response", json );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					
					test.ok( !!json.params, "Found params object in JSON response" );
					test.ok( json.params.foo == "barpost", "Correct param in JSON response: " + json.params.foo );
					
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					test.ok( !!json.headers.ssl, "SSL pseudo-header present in echo" );
					
					test.done();
				} 
			);
		},
		
		// https_header_detect
		function testHTTPSHeaderDetect(test) {
			// test HTTP GET request to webserver backend, simulating an external SSL proxy (LB, etc.)
			request.json( 'http://127.0.0.1:3020/json', false,
				{
					headers: {
						'X-Forwarded-Proto': "https",
						'X-Test': "Test"
					}
				},
				function(err, resp, json, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
					test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
					test.ok( !!json, "Got JSON in response" );
					test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
					test.ok( !!json.user, "Found user object in JSON response" );
					test.ok( json.user.Name == "Joe", "Correct user name in JSON response: " + json.user.Name );
					
					// request headers will be echoed back
					test.ok( !!json.headers, "Found headers echoed in JSON response" );
					test.ok( json.headers['x-test'] == "Test", "Found Test header echoed in JSON response" );
					
					// even though this wasn't an SSL request, we simulated one, which should have triggered https_header_detect
					test.ok( !!json.headers.ssl, "SSL pseudo-header present in echo" );
					
					test.done();
				} 
			);
		},
		
		// filters
		function testFilterPassthrough(test) {
			// setup filter for passthrough
			var self = this;
			
			this.web_server.addURIFilter( /^\/json/, "Test Filter", function(args, callback) {
				// add a nugget into request query
				args.query.filter_nugget = 42;
				
				// add a custom response header too
				args.response.setHeader('X-Filtered', "4242");
				
				callback(false); // passthru
			} );
			
			request.json( 'http://127.0.0.1:3020/json', false, function(err, resp, json, perf) {
				test.ok( !err, "No error from PixlRequest: " + err );
				test.ok( !!resp, "Got resp from PixlRequest" );
				test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
				test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
				test.ok( !!json, "Got JSON in response" );
				test.ok( json.code == 0, "Correct code in JSON response: " + json.code );
				
				// did our query nugget make it all the way through?
				test.ok( json.query.filter_nugget == "42", "Found filter nugget infused into query" );
				
				// and our response header nugget too?
				test.ok( resp.headers['x-filtered'] == "4242", "Correct X-Filtered header: " + resp.headers['x-filtered'] );
				
				// remove filter
				self.web_server.removeURIFilter('Test Filter');
				
				test.done();
			} );
		},
		
		function testFilterIntercept(test) {
			// setup filter for intercepting request and sending custom response
			var self = this;
			
			this.web_server.addURIFilter( /.+/, "Test Filter 418", function(args, callback) {
				// send our own custom response
				callback(
					"418 I'm a teapot", 
					{ 'X-Filtered': 42 },
					null
				);
			} );
			
			request.get( 'http://127.0.0.1:3020/index.html',
				function(err, resp, data, perf) {
					test.ok( !err, "No error from PixlRequest: " + err );
					test.ok( !!resp, "Got resp from PixlRequest" );
					test.ok( resp.statusCode == 418, "Got 418 response: " + resp.statusCode );
					test.ok( resp.headers['x-filtered'] == 42, "Correct X-Filtered header: " + resp.headers['x-filtered'] );
					
					// remove filter
					self.web_server.removeURIFilter('Test Filter 418');
					
					// make sure things are back to good
					request.get( 'http://127.0.0.1:3020/index.html',
						function(err, resp, data, perf) {
							test.ok( !err, "No error from PixlRequest: " + err );
							test.ok( !!resp, "Got resp from PixlRequest" );
							test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
							test.ok( resp.headers['via'] == "WebServerTest 1.0", "Correct Via header: " + resp.headers['via'] );
							test.done();
						}
					); // request.get #2
				}
			); // request.get #1
		},
		
		function waitForAllSockets2(test) {
			// wait for all sockets to close for next test (requires clean slate)
			var self = this;
			
			test.debug("Connections still open: ", Object.keys(self.web_server.conns) );
			
			for (var id in this.web_server.conns) {
				this.web_server.conns[id].end();
			}
			
			async.whilst(
				function(cb) { 
					cb( null, Object.keys(self.web_server.conns).length > 0 );
				},
				function(callback) {
					setTimeout( function() { callback(); }, 100 );
				},
				function() {
					test.done();
				}
			); // async.whilst
		},
		
		// http_max_concurrent_requests
		function testMaxConcurrentRequests(test) {
			// test going over max concurrent requests, remainder should be queued
			var self = this;
			test.expect( 1 + (3 * 10) + 2 + 2 );
			this.web_server.queue.concurrency = 5;
			
			// open 10 concurrent, 5 should queue
			// test.debug( "Stats:", self.web_server.getStats() );
			test.ok( Object.keys(self.web_server.conns).length == 0, "Oops, there's one or more sockets left" );
			
			async.times( 10,
				function(idx, callback) {
					request.get( 'http://127.0.0.1:3020/sleep?ms=500',
						function(err, resp, data, perf) {
							test.ok( !err, "No error from PixlRequest: " + err );
							test.ok( !!resp, "Got resp from PixlRequest" );
							test.ok( resp.statusCode == 200, "Got 200 response: " + resp.statusCode );
							callback();
						}
					);
				},
				function() {
					// all 10 requests completed, queue should be empty now
					var stats = self.web_server.getStats();
					test.ok( stats.queue.pending == 0, "Expected 0 pending requests, got: " + stats.queue.pending );
					test.ok( stats.queue.running == 0, "Expected 0 running requests, got: " + stats.queue.running );
					test.done();
				}
			); // async.times
			
			// sleep for 250ms, then grab stats
			setTimeout( function() {
				// now, 5 requests should be in progress, and 5 queued
				var stats = self.web_server.getStats();
				test.ok( stats.queue.pending == 5, "Expected 5 pending requests, got: " + stats.queue.pending );
				test.ok( stats.queue.running == 5, "Expected 5 running requests, got: " + stats.queue.running );
			}, 250 );
		}
		
	], // tests
	
	tearDown: function (callback) {
		// clean up
		var self = this;
		
		this.server.shutdown( function() {
			callback();
		} );
	}
	
};
