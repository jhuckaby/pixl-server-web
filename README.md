# Overview

This module is a component for use in [pixl-server](https://www.npmjs.com/package/pixl-server).  It implements a simple web server with support for both HTTP and HTTPS, serving static files, and hooks for adding custom URI handlers.

# Usage

Use [npm](https://www.npmjs.com/) to install the module:

```
	npm install pixl-server pixl-server-web
```

Here is a simple usage example.  Note that the component's official name is `WebServer`, so that is what you should use for the configuration key, and for gaining access to the component via your server object.

```javascript
	var PixlServer = require('pixl-server');
	var server = new PixlServer({
		
		__name: 'MyServer',
		__version: "1.0",
		
		config: {
			"log_dir": "/var/log",
			"debug_level": 9,
			
			"WebServer": {
				"http_port": 80,
				"http_htdocs_dir": "/var/www/html"
			}
		},
		
		components: [
			require('pixl-server-web')
		]
		
	});
	
	server.startup( function() {
		// server startup complete
		
		server.WebServer.addURIHandler( '/my/custom/uri', 'Custom Name', function(args, callback) {
			// custom request handler for our URI
			callback( 
				"200 OK", 
				{ 'Content-Type': "text/html" }, 
				"Hello this is custom content!\n" 
			);
		} );
	} );
```

Notice how we are loading the [pixl-server](https://www.npmjs.com/package/pixl-server) parent module, and then specifying [pixl-server-web](https://www.npmjs.com/package/pixl-server-web) as a component:

```javascript
	components: [
		require('pixl-server-web')
	]
```

This example is a very simple web server configuration, which will listen on port 80 and serve static files out of `/var/www/html`.  However, if the URI is `/my/custom/uri`, a custom callback function is fired and can serve up any response it wants.  This is a great way to implement an API.

# Configuration

The configuration for this component is set by passing in a `WebServer` key in the `config` element when constructing the `PixlServer` object, or, if a JSON configuration file is used, a `WebServer` object at the outermost level of the file structure.  It can contain the following keys:

## http_port

This is the port to listen on.  The standard web port is 80, but note that only the root user can listen on ports below 1024.

## http_docs_dir

This is the path to the directory to serve static files out of, e.g. `/var/www/html`.

## http_max_upload_size

This is the maximum allowed upload size.  If uploading files, this is a per-file limit.  If submitting raw data, this is an overall POST content limit.  The default is 32MB.

## http_temp_dir

This is where file uploads will be stored temporarily, until they are renamed or deleted.  If omitted, this defaults to the operating system's temp directory, as returned from `os.tmpDir()`.

## http_static_ttl

This is the TTL (time to live) value to pass on the `Cache-Control` response header.  This causes static files to be cached for a number of seconds.  The default is 0 seconds.

## http_static_index

This sets the filename to look for when directories are requested.  It defaults to `index.html`.

## http_server_signature

This is a string to send back to the client with every request, as the `Server` HTTP response header.  This is typically used to declare the web server software being used.  The default is `WebServer`;

## http_gzip_text

This is a boolean indicating whether or not to compress text responses using GZip ([zlib](https://nodejs.org/api/zlib.html) software compression in Node.js).  The default is `false`.

## http_regex_text

This is a regular expression string which is compared against the `Content-Type` response header.  When this matches, and [http_gzip_text](#http_gzip_text) is enabled, this will kick in GZip compression.  It defaults to `(text|javascript|json|css|html)`.

## http_regex_json

This is a regular expression string used to determine if the incoming POST request contains JSON.  It is compared against the `Content-Type` request header.  The default is `(javascript|js|json)`.

## http_response_headers

This param allows you to send back any additional custom HTTP headers with each response.  Set the param to an object containing keys for each header, like this:

```javascript
	{
		http_response_headers: {
			"X-My-Custom-Header": "12345",
			"X-Another-Header": "Hello"
		}
	}
```

## http_timeout

This sets the idle socket timeout for all incoming HTTP requests.  If omitted, the Node.js default is 2 minutes.  Please specify your value in seconds.

## https

This boolean allows you to enable HTTPS (SSL) support in the web server.  It defaults to `false`.  Note that you must also set `https_port`, `https_cert_file` and `https_key_file` for this to work.

## https_port

If HTTPS mode is enabled, this is the port to listen on for secure requests.  The standard HTTPS port is 443.

## https_cert_file

If HTTPS mode is enabled, this should point to your SSL certificate file on disk.  The certificate file typically has a `.crt` filename extension.

## https_key_file

If HTTPS mode is enabled, this should point to your SSL key file on disk.  The key file typically has a `.key` filename extension.

## https_force

If HTTPS mode is enabled, you can set this param to boolean `true` to force all requests to be HTTPS.  Meaning, if someone attempts a non-secure plain HTTP request to any URI, their client will be redirected to an equivalent HTTPS URI.

## https_header_detect

Your network architecture may have a proxy server or load balancer sitting in front of the web server, and performing all HTTPS/SSL encryption for you.  Usually, these devices inject some kind of HTTP request header into the back-end web server request, so you can "detect" a front-end HTTPS proxy request in your code.  For example, Amazon AWS load balancers inject the following HTTP request header into all back-end requests:

```
	Front-End-Https: on
```

The `https_header_detect` property allows you to define any number of header regular expression matches, that will "pseudo-enable" SSL mode in the web server.  Meaning, the `args.request.headers.ssl` property will be set to `true`, and calls to {server.getSelfURL()} will have a `https://` prefix.  Here is an example configuration, which detects many commonly used headers:

```javascript
	{
		https_header_detect: {
			"Front-End-Https": "^on$",
			"X-Url-Scheme": "^https$",
			"X-Forwarded-Protocol": "^https$",
			"X-Forwarded-Proto": "^https$",
			"X-Forwarded-Ssl": "^on$"
		}
	}
```

Note that these are matched using logical OR, so only one of them needs to match to enable SSL mode.  The values are interpreted as regular expressions, in case you need to match more than one value.

## https_timeout

This sets the idle socket timeout for all incoming HTTPS requests.  If omitted, the Node.js default is 2 minutes.  Please specify your value in seconds.

# Custom URI Handlers

You can attach your own handler methods for intercepting and responding to certain incoming URIs.  So for example, instead of the URI `/api/add_user` looking for a static file on disk, you can have the web server invoke your own function for handling it, and sending a custom response.  

To do this, call the `addURIHandler()` method and pass in the URI string, a name (for logging), and a callback function:

```javascript
	server.WebServer.addURIHandler( '/my/custom/uri', 'Custom Name', function(args, callback) {
		// custom request handler for our URI
		callback( 
			"200 OK", 
			{ 'Content-Type': "text/html" }, 
			"Hello this is custom content!\n" 
		);
	} );
```

URIs must match exactly (sans the query string), and the case is sensitive.  If you need to implement something more complicated, such as a regular expression match, you can pass one of these in as well.  Example:

```javascript
	server.WebServer.addURIHandler( /^\/custom\/match\/$/i, 'Custom2', function(args, callback) {...} );
```

Your handler function is passed exactly two arguments.  First, an `args` object containing all kinds of useful information about the request (see [args](#args) below), and a callback function that you must call when the request is complete and you want to send a response.

If you specified a regular expression with paren groups for the URI, the matches array will be passed into the `args` object as `args.matches`.  Using this you can extract your matched groups from the URI, for e.g. `/^\/api\/(\w+)/`.

## Sending Responses

There are actually four different ways you can send an HTTP response.  They are all detailed below:

### Standard Response

The first type of response is shown above, and that is passing three arguments to the callback function.  The HTTP response status line (e.g. `200 OK` or `404 File Not Found`), a response headers object containing key/value pairs for any custom headers you want to send back (will be combined with the default ones), and finally the content body.  Example:

```javascript
	callback( 
		"200 OK", 
		{ 'Content-Type': "text/html" }, 
		"Hello this is custom content!\n" 
	);
```

### Custom Response

The second type of response is to send content directly to the underlying Node.js server by yourself, using `args.response` (see below).  If you do this, you can pass `true` to the callback function, indicating to the web server that you "handled" the response, and it shouldn't do anything else.  Example:

```javascript
	server.WebServer.addURIHandler( '/my/custom/uri', 'Custom Name', function(args, callback) {
		// send custom raw response
		var response = args.response;
		response.writeHead( 200, "OK", { 'Content-Type': "text/html" } );
		response.write( "Hello this is custom content!\n" );
		response.end();
		
		// indicate we are done, and have handled things ourselves
		callback( true );
	} );
```

### JSON Response

The third way is to pass a single object to the callback function, which will be serialized to JSON and sent back as an AJAX style response to the client.  Example:

```javascript
	server.WebServer.addURIHandler( '/my/custom/uri', 'Custom Name', function(args, callback) {
		// send custom JSON response
		callback( {
			Code: 0,
			Description: "Success",
			User: { Name: "Joe", Email: "foo@bar.com" }
		} );
	} );
```

Typically this is sent as pure JSON with the Content-Type `application/json`.  The raw HTTP response would look something like this:

```
	HTTP/1.1 200 OK
	Connection: keep-alive
	Content-Length: 79
	Content-Type: application/json
	Date: Sun, 05 Apr 2015 20:58:50 GMT
	Server: Test 1.0
	
	{"Code":0,"Description":"Success","User":{"Name":"Joe","Email":"foo@bar.com"}}
```

Now, depending on the request URL's query string, two variants of the JSON response are possible.  First, if there is a `callback` query parameter present, it will be prefixed onto the front of the JSON payload, which will be wrapped in parenthesis, and Content-Type will be switched to `text/javascript`.  This is an AJAX / JSONP style of response, and looks like this, assuming a request URL containing `?callback=myfunc`:

```
	HTTP/1.1 200 OK
	Connection: keep-alive
	Content-Length: 88
	Content-Type: text/javascript
	Date: Sun, 05 Apr 2015 21:25:49 GMT
	Server: Test 1.0
	
	myfunc({"Code":0,"Description":"Success","User":{"Name":"Joe","Email":"foo@bar.com"}});
```

And finally, if the request URL's query string contains both a `callback`, and a `format` parameter set to `html`, the response will be actual HTML (Content-Type `text/html`) with a `<script>` tag embedded containing the JSON and callback wrapper.  This is useful for IFRAMEs which may need to talk to their parent window after a form submission.  Here is an example assuming a request URL containing `?callback=parent.myfunc&format=html`:

```
	HTTP/1.1 200 OK
	Connection: keep-alive
	Content-Length: 151
	Content-Type: text/html
	Date: Sun, 05 Apr 2015 21:28:48 GMT
	Server: Test 1.0
	
	<html><head><script>parent.myfunc({"Code":0,"Description":"Success","User":{"Name":"Joe","Email":"foo@bar.com"}});
	</script></head><body>&nbsp;</body></html>
```

### Non-Response

The fourth and final type of response is a non-response, and this is achieved by passing `false` to the callback function.  This indicates to the web server that your code did *not* handle the request, and it should fall back to looking up a static file on disk.  Example:

```javascript
	server.WebServer.addURIHandler( '/my/custom/uri', 'Custom Name', function(args, callback) {
		// we did not handle the request, so tell the web server to do so
		callback( false );
	} );
```

Note that there is currently no logic to fallback to other custom URI handlers.  The only fallback logic, if a handler returns false, is to lookup a static file on disk.

## args

Your URI handler function is passed an `args` object containing the following properties:

### args.request

This is a reference to the underlying [Node.js server request](https://nodejs.org/api/http.html#http_http_incomingmessage) object.  From this you have access to things like:

| Property | Description |
|----------|-------------|
| `request.httpVersion` | The version of the HTTP protocol used in the request. |
| `request.headers` | An object containing all the HTTP request headers (lower-cased). | 
| `request.method` | The HTTP method used in the request, e.g. `GET`, `POST`, etc. | 
| `request.url` | The complete URI of the request (sans protocol and hostname). | 
| `request.socket` | A reference to the underlying socket connection for the request. | 

For more detailed documentation on the request object, see Node's [http.IncomingMessage](https://nodejs.org/api/http.html#http_http_incomingmessage).

### args.response

This is a reference to the underlying [Node.js server response](https://nodejs.org/api/http.html#http_class_http_serverresponse) object.  From this you have access to things like:

| Property / Method() | Description |
|----------|-------------|
| `response.writeHead()` | This writes the HTTP status code, message and headers to the socket. |
| `response.setTimeout()` | This sets a timeout on the response. |
| `response.statusCode` | This sets the HTTP status code, e.g. 200, 404, etc. |
| `response.statusMessage` | This sets the HTTP status message, e.g. OK, File Not Found, etc. |
| `response.setHeader()` | This sets a single header key / value pair in the response. |
| `response.write()` | This writes a chunk of data to the socket. |
| `response.end()` | This indicates that the response has been completely sent. |

For more detailed documentation on the response object, see Node's [http.ServerResponse](https://nodejs.org/api/http.html#http_class_http_serverresponse).

### args.ip

This will be set to the user's remote IP address.  Specifically, it will be set to the *first public IP address* if multiple addresses are provided via the `X-Forwarded-For` header and the socket.

Meaning, if the user is sitting behind one or more proxy servers, *or* your web server is behind a load balancer, this will attempt to locate the user's true public (non-private) IP address.  If none is found, it'll just return the first IP address, honoring `X-Forwarded-For` before the socket (which is usually correct).

If you just want the socket IP by itself, you can get it from `args.request.socket.remoteAddress`.

### args.ips

This will be set to an array of *all* the user's remote IP addresses, taking into account the socket IP and the `X-Forwarded-For` HTTP header, if applicable.  The `X-Forwarded-For` address(es) will come first, if applicable, followed by the socket IP at the end.

### args.query

This will be an object containing key/value pairs from the URL query string, if applicable, parsed via the Node.js core [Query String](https://nodejs.org/api/querystring.html) module.

Duplicate query params become an array.  For example, an incoming URI such as `/something?foo=bar1&foo=bar2&name=joe` would produce the following `args.query` object:

```javascript
	{
		"foo": ["bar1", "bar2"],
		"name": "joe"
	}
```

### args.params

If the request was a HTTP POST, this will contain all the post parameters as key/value pairs.  This will take one of three forms, depending on the request's `Content-Type` header:

#### Standard HTTP POST

If the request Content-Type was one of the standard `application/x-www-form-urlencoded` or `multipart/form-data`, all the key/value pairs from the post data will be parsed, and provided in the `args.params` object.  We use the 3rd party [Formidable](https://www.npmjs.com/package/formidable) module for this work.

#### JSON REST POST

If the request is a "pure" JSON POST, meaning the Content-Type contains `json` or `javascript`, the content body will be parsed as a single JSON string, and the result object placed into `args.params`.

#### Unknown POST

If the Content-Type doesn't match any of the above values, it will simply be treated as a plain binary data, and a [Buffer](https://nodejs.org/api/buffer.html) will be placed into `args.params.raw`.

### args.files

If the request was a HTTP POST and contained any file uploads, they will be accessible through this property.  Files are saved to a temp directory and can be moved to a custom location, or loaded directly.  They will be keyed by the POST parameter name, and the value will be an object containing the following properties:

| Property | Description |
|----------|-------------|
| `size` | The size of the uploaded file in bytes. |
| `path` | The path to the temp file on disk containing the file contents. |
| `name` | The name of the file POST parameter. |
| `type` | The mime type of the file, according to the client. |
| `lastModifiedDate` | A date object containing the last mod date of the file, if available. |

For more details, please see the documentation on the [Formidable.File](https://github.com/felixge/node-formidable#formidablefile) object.

All temp files are automatically deleted at the end of the request.

### args.cookies

This is an object parsed from the incoming `Cookie` HTTP header, if present.  The contents will be key/value pairs for each semicolon-separated cookie provided.  For example, if the client sent in a `session_id` cookie, it could be accessed like this:

```javascript
	var session_id = args.cookies['session_id'];
```

### args.server

This is a reference to the pixl-server object which handled the request.

# Misc

## Determining HTTP or HTTPS

To determine if a request is HTTP or HTTPS, check to see if there is an `args.request.headers.ssl` property.  If so, and this is set to a `true` value, then the request was sent in via HTTPS, otherwise you can assume it was HTTP.

Please note that if you have a load balancer or other proxy handling HTTPS / SSL for you, the final request to the web server may not be HTTPS.  To determine if the *original* request from the client was HTTPS, you may need to sniff for a particular request header, e.g. `Front-End-Https` (used by Amazon ELB).

See the [https_header_detect](#https_header_detect) configuration property for an automatic way to handle this.

## Self-Referencing URLs

To build a URL string that points at the current server, call `server.getSelfURL()` and pass in the `args.request` object.  This will produce a URL using the correct protocol (HTTP or HTTPS), the hostname used on the request, and the port number if applicable.  Example:

```javascript
	var url = server.getSelfURL(args.request);
```

You can optionally pass in a custom URI as the second argument.

## Custom Method Handlers

You can also register a handler that is invoked for every single request for a given request method (i.e. `GET`, `POST`, `HEAD`, `OPTIONS`, etc.).  So instead of matching on the URI, this matches *all* requests for a specific method.  Method handlers are matched first, before URIs are checked.  

To use this, call the server `addMethodHandler()` method, and pass in the method name, title (for logging), and a callback function.  One potential use of this is to capture `OPTIONS` requests, which browsers send in for [CORS AJAX Preflights](https://developer.mozilla.org/en-US/docs/Web/HTTP/Access_control_CORS).  Example:

```javascript
	server.WebServer.addMethodHandler( "OPTIONS", "CORS Preflight", function(args, callback) {
		// handler for HTTP OPTIONS calls (CORS AJAX preflight)
		callback( "200 OK", 
			{
				'Access-Control-Allow-Origin': args.request.headers['origin'] || "*",
				'Access-Control-Allow-Methods': "POST, GET, HEAD, OPTIONS",
				'Access-Control-Allow-Headers': args.request.headers['access-control-request-headers'] || "*",
				'Access-Control-Max-Age': "1728000",
				'Content-Length': "0"
			},
			null
		);
	} );
```

# License

The MIT License (MIT)

Copyright (c) 2015 - 2016 Joseph Huckaby.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
