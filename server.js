/**
 * Node Websocket Server
 *
 * @version 1.0
 * @author Justin Stolpe
 * @source https://github.com/jstolpe/node_websocket_server
 * @license 
 *		Copyright (c) 2017 Justin Stolpe
 *
 *		Permission is hereby granted, free of charge, to any person obtaining a copy
 *		of this software and associated documentation files (the "Software"), to deal
 *		in the Software without restriction, including without limitation the rights
 *		to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *		copies of the Software, and to permit persons to whom the Software is
 *		furnished to do so, subject to the following conditions:
 *
 *		The above copyright notice and this permission notice shall be included in all
 *		copies or substantial portions of the Software.
 *
 *		THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *		IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *		FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *		AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *		LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *		OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *		SOFTWARE.
 */

// socket io setup
var app = require( 'express' )();

// used for parsing html body
var bodyParser = require( 'body-parser' );
app.use( bodyParser.urlencoded( { extended: false } ) );
app.use( bodyParser.json() );

// hold all the rooms that are currently open
var liveRooms = [];

try { // include defines.js which holds server specific settings
	// include defines.js where you set your server specific settings
	var defines = require( './defines' );

	// http/https
	var connectionType = defines.connectionType;

	// get https options from defines
	var connectionHTTPSOptions = defines.connectionHTTPSOptions;

	// what hosts can access this server
	var allowedHosts = defines.allowedHosts;

	// port to listen on
	var portToListenOn = defines.httpListenPortNumber;

	// header secrete to pass along when hitting this server
	var nodeServerHeaderKey = defines.nodeServerHeaderKey;

	// try and remove user after disconnect
	var removeUserTimeInterval = defines.removeUserTimeInterval;

	// how often to clear out guests
	var clearGuestsTimeInterval = defines.clearGuestsTimeInterval;
} catch( ex ) { // if no defines.js exists, default to super secure mode! jk...go create defines.js now!  
	// http/https default to http
	var connectionType = 'HTTP';

	// not using https so options are empty
	var connectionHTTPSOptions = {};

	// allow access can access this server! gg!
	var allowedHosts = '';

	// defaults to this port
	var portToListenOn = 3000;

	// default to no secret for validating requests to this server
	var nodeServerHeaderKey = '';

	// default time interval for server to try and remove a user
	var removeUserTimeInterval = 10000;

	// default time interval for server to try and clear guests out of rooms
	var clearGuestsTimeInterval = 10000;
}

if ( 'HTTP' == connectionType ) { // setup HTTP server
	// create http server
	var http = require( 'http' ).Server( app ).listen( portToListenOn, function(){});

	// open socket io
	var io = require( 'socket.io' )( http );
} else if ( 'HTTPS' == connectionType ) { // setup HTTPS server
	// require file system
	var fs = require( 'fs' );

	// require https
	var https = require( 'https' );

	// options passed when setting up https server
	var httpsOptions = {};

	if ( 'key' in connectionHTTPSOptions ) { // get private key file
		httpsOptions.key = fs.readFileSync( connectionHTTPSOptions.key ); 
	}

	if ( 'cert' in connectionHTTPSOptions ) { // get cert file
		httpsOptions.cert = fs.readFileSync( connectionHTTPSOptions.cert ); 
	}

	if ( 'ca' in connectionHTTPSOptions ) { // get ca if provided
		httpsOptions.ca = fs.readFileSync( connectionHTTPSOptions.ca ); 
	}

	if ( 'requestCert' in connectionHTTPSOptions ) { // set option
		httpsOptions.requestCert = connectionHTTPSOptions.requestCert; 
	}

	if ( 'requestCert' in connectionHTTPSOptions ) { // set option
		httpsOptions.rejectUnauthorized = connectionHTTPSOptions.rejectUnauthorized; 
	}

	// setup server
	var server = https.createServer( httpsOptions, app ).listen( portToListenOn );

	// open socket io
	var options = {
		cors: true,
		origins: allowedHosts
	}
	var io = require( 'socket.io' )( server, options );
}

/**
 * Called when a connection is made
 *	
 * @param Object socket
 *
 * @return void	
 */
io.on('connection', function( socket ) { // called on new connection
	/**
	 * Join a room
	 *	
	 * @param Object room
	 *
	 * @return void	
	 */
	socket.on( 'room', function( room ) { // called whenever a users joins any room
    	// join the room
    	socket.join( room.name );

    	// get index of room in the liveRooms array
    	var roomIndex = getRoomIndex( room );

    	if ( roomIndex != -1 ) { // room already exists
    		// check if user is already in the room
    		var userIndex = getRoomUserIndex( room.userKey, liveRooms[roomIndex] );

    		if ( userIndex != -1 ) { // user is already in the room
    			// add user socket id to the users array of socket ids
    			liveRooms[roomIndex].clients[userIndex].socketIds.push( socket.id );

				// emit room data to user who just connected
				emitRoomDataToSocket( 'user_join', liveRooms[roomIndex], room.userKey, socket );
    		} else { // user is not in the room yet
	    		liveRooms[roomIndex].clients.push({ // add user to the room
	    			userKey: room.userKey,
					socketIds: [socket.id]
				});

				// emit room data to users
				emitRoomDataToUsers( 'user_join', liveRooms[roomIndex], room.userKey );
			}
    	} else { // room does not exist yet
    		var newRoom = { // create new room and add user to it
    			name: room.name,
    			clients: [{
    				userKey: room.userKey,
    				socketIds: [socket.id]
    			}]
    		};

    		// add room to rooms array
    		liveRooms.push( newRoom );

    		// emit room data to users
    		emitRoomDataToUsers( 'user_join', newRoom, room.userKey );
    	}
	});

	/**
	 * Disconnect from a room
	 *	
	 * @param void
	 *
	 * @return void	
	 */
	socket.on('disconnect', function(){ // called when a user disconnects
		for ( i = 0; i < liveRooms.length; i++ ) { // loop over rooms
    		for ( j = 0; j < liveRooms[i].clients.length; j++ ) { // loop over users in the room
    			for ( k = 0; k < liveRooms[i].clients[j].socketIds.length; k++ ) { // loop over users socket ids
    				if ( socket.id == liveRooms[i].clients[j].socketIds[k] ) {
    					// remove socket id from users socket ids array
    					liveRooms[i].clients[j].socketIds.splice( k, 1 );

    					if ( !liveRooms[i].clients[j].socketIds.length ) { // user has no more socket ids
    						var roomIndexCounter = i;
    						var clientIndexCounter = j;

    						// remove user after X seconds
    						setRemoveUserTimeout( roomIndexCounter, clientIndexCounter, socket.id );
    					}
    				}
    			}

    		}
    	}
	});
});

// initialize cleanup
setTimeout( cleanUpGuests, clearGuestsTimeInterval );

/**
 * Post data to rooms
 *	
 * @param Array req
 * @param Array res
 *
 * @return void	
 */
app.post('/broadcast', function( req, res ){ // called when broadcast gets a POST
	if ( validPost( req ) ) { // is valid post
		io.emit( req.body.room_name, req.body );
	}

	// make node server happy
	res.sendStatus( 200 );
	res.end();
});

/**
 * Post data to multiple rooms
 *	
 * @param Array req
 * @param Array res
 *
 * @return void	
 */
app.post('/multibroadcast', function( req, res ){ // called when broadcast gets a POST
	if ( validPost( req ) ) { // is valid post
		for ( var i = 0; i < req.body.length; i++ ) { // emit data to each room
			io.emit( req.body[i].room_name, req.body[i] );
		}
	}

	// make node server happy
	res.sendStatus( 200 );
	res.end();
});

/**
 * Web path for getting live rooms data
 *	
 * @param Array req
 * @param Array res
 *
 * @return void	
 */
app.get('/getliverooms', function ( req, res ) {
	if ( validPost( req ) ) { // make sure we have a valid request with secret key
 	   	res.send( liveRooms );
	} else { // not a valid secret key in the headers of the request
		res.send([{
			status: 'fail',
			message: 'No data for you!'
		}]);
	}
});

/**
 * Verify post
 *	
 * @param Array req
 *
 * @return Boolean isValid	
 */
function validPost( req ) {
	if ( nodeServerHeaderKey ) { // make sure header key passed in headers mathces server header key
		// assume not valid
		var isValid = false;

		if ( typeof req.headers.secretheaderkey != "undefined" &&
			 req.headers.secretheaderkey == nodeServerHeaderKey
		) { // make sure post has secret header key, we do, much excite!
			isValid = true;
		}
	} else { // no header key needed! much secure!
		var isValid = true;
	}

	return isValid;
}

/**
 * Get room index of room in the array
 *	
 * @param Array room
 *
 * @return Integer roomIndex	
 */
function getRoomIndex( room ) {
	var roomIndex = -1;

	for ( i = 0; i < liveRooms.length; i++ ) { // loop over rooms array
		if ( room.name == liveRooms[i].name ) { // room found
			roomIndex = i;
		 	break;
		}
	}

	return roomIndex;
}

/**
 * Get room user index of ujser in the room array
 *	
 * @param String userKey
 * @param Array sdRoom
 *
 * @return Integer userIndex	
 */
function getRoomUserIndex( userKey, sdRoom ) {
	var userIndex = -1;

	for ( var i = 0; i < sdRoom.clients.length; i++ ) { // loop over users in the room
		if ( userKey == sdRoom.clients[i].userKey ) { // user found in the room
			userIndex = i;
			break;
		}
	}

	return userIndex;
}

/**
 * Get array of user keys in the room
 *	
 * @param Array room
 *
 * @return Array roomUserKeys
 */
function getRoomUserKeys( room ) {
	var roomUserKeys = [];

	for ( var i = 0; i < room.clients.length; i++ ) {
		roomUserKeys.push( room.clients[i].userKey );
	}

	return roomUserKeys;
}

/**
 * Emit room data to users
 *	
 * @param String actionType
 * @param Array room
 * @param String userKey
 *
 * @return void
 */
function emitRoomDataToUsers( actionType, room, userKey ) {
	// get room data
	var roomData = createRoomData( actionType, room, userKey );

	/// emit room data to room
	io.emit( room.name, roomData );
}

/**
 * Emit room data to socket
 *	
 * @param String actionType
 * @param Array room
 * @param String userKey
 * @param Object socket
 *
 * @return void
 */
function emitRoomDataToSocket( actionType, room, userKey, socket ) {
	// get room data
	var roomData = createRoomData( actionType, room, userKey );

	// emit data to socket
	socket.emit( room.name, roomData );
}

/**
 * Get room data
 *	
 * @param String actionType
 * @param Array room
 * @param String userKey
 *
 * @return Object for room
 */
function createRoomData( actionType, room, userKey ) {
	return {
		type: 'node',
		action: {
			name: actionType,
			userKey: userKey
		},
		room: {
			name: room.name,
			users: getRoomUserKeys( room )
		}
	};
}

/**
 * Clean up guest users who are gone
 *	
 * @param void
 *
 * @return void	
 */
function cleanUpGuests() {
    for ( i = 0; i < liveRooms.length; i++ ) { // loop over rooms
    	for ( j = 0; j < liveRooms[i].clients.length; j++ ) { // loop over users in the room
    		var removeUserKey = liveRooms[i].clients[j].userKey;
    		var userGuest = removeUserKey.substring(0,5);

			if ( userGuest == 'guest' &&
				!liveRooms[i].clients[j].socketIds.length
			) { // remove user from room
				liveRooms[i].clients.splice( j, 1 );

				// emit room data to user who just connected
				emitRoomDataToUsers( 'user_left', liveRooms[i], removeUserKey );
			}
    	}
    }

    // set timeout for clearing out guests from rooms
    setTimeout( cleanUpGuests, clearGuestsTimeInterval );
}

/**
 * Remove user delaly
 *	
 * @param Integer roomIndexCounter
 * @param Integer clientIndexCounter
 *
 * @return void	
 */
function setRemoveUserTimeout( roomIndexCounter, clientIndexCounter ) {
	setTimeout(function () { // wait to see if user comes back
		// remove user from the room
		removeUser( roomIndexCounter, clientIndexCounter );
	}, removeUserTimeInterval);
}

/**
 * Remove a user
 *	
 * @param Integer roomIndexCounter
 * @param Integer clientIndexCounter
 *
 * @return void	
 */
function removeUser( roomIndexCounter, clientIndexCounter ) {
	if ( typeof liveRooms[roomIndexCounter] !== "undefined" &&
		 typeof liveRooms[roomIndexCounter].clients !== "undefined" &&
		 typeof liveRooms[roomIndexCounter].clients[clientIndexCounter] !== "undefined" && 
		 typeof liveRooms[roomIndexCounter].clients[clientIndexCounter].socketIds !== "undefined" && 
		 !liveRooms[roomIndexCounter].clients[clientIndexCounter].socketIds.length ) { // user has left the building

		var removeUserKey = liveRooms[roomIndexCounter].clients[clientIndexCounter].userKey;

		// remove user from room
		liveRooms[roomIndexCounter].clients.splice( clientIndexCounter, 1 );

		// emit room data to user who just connected
		emitRoomDataToUsers( 'user_left', liveRooms[roomIndexCounter], removeUserKey );

		if ( !liveRooms[roomIndexCounter].clients.length ) { // remove room if no users are in it
			liveRooms.splice( roomIndexCounter, 1 );
		}
	}
}