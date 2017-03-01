var net = require('net');
var fs = require('fs');
var express = require('express');
var app = express();
var moment = require('moment');
var envisalink = require('./envisalinkdefs.js');

var data = fs.readFileSync('/home/brumple/dev/node_alarmserver/alarmserver-config.json'), config;
try {
    var i = 0;
    data = data.toString('utf8');
    var sdata = '';
    while (i < data.length) {
	var j = data.indexOf("\n", i);
	if (j == -1) j = data.length;
	var t = data.substr(i, j-i);
	t = t.replace(/\/\/.*/, '');
	sdata += t;
	i = j+1;
    }

    config = JSON.parse(sdata);
} catch (err) {
    console.log('There has been an error parsing your JSON.')
    console.log(err);
}

app.use(express.static('ext'));

var ALARMSTATE = {'version': 0.2, 'arm': false, 'disarm': false, 'cancel': false}

ALARMSTATE['zone'] = {'lastevents': []}
for (var property in config.alarmserver.zones) {
    if (config.alarmserver.zones.hasOwnProperty(property)) {
	var zoneNumber = property.replace(/\D+/, '');
	var zoneName = config.alarmserver.zones[property];
	ALARMSTATE['zone'][zoneNumber] = {'name': zoneName, 'lastevents': [],
                                          'lastfault': 'Last Closed longer ago than I can remember',
                                          'status': {'open': false, 'fault': false, 'alarm': false, 'tamper': false}
                                         }
    }
}

ALARMSTATE['partition'] = {'lastevents': []}
for (var property in config.alarmserver.partitions) {
    if (config.alarmserver.partitions.hasOwnProperty(property)) {
	var pNumber = property.replace(/\D+/, '');
	var pName = config.alarmserver.partitions[property];
        ALARMSTATE['partition'][pNumber] = {'name': pName, 'lastevents': [],
                                            'lastfault': 'Last Closed longer ago than I can remember',
                                            'status': {'alarm': false, 'alarm_in_memory': false, 'armed_away': false,
                                                       'ac_present': false, 'armed_bypass': false, 'chime': false,
                                                       'armed_zero_entry_delay': false, 'alarm_fire_zone': false,
                                                       'trouble': false, 'ready': false, 'fire': false,
                                                       'armed_stay': false, 'alpha': false, 'beep': false}}
    }
}

var loggedin = false;
var commandinprogress = false;
var lastcommand;
var lastcommandresponse;
var lastpollresponse;
var alarmcode = config.envisalink.alarmcode;
var has_partition_state_changed = false;

app.get('/api', function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(ALARMSTATE));
});

app.get('/api/alarm/arm', function(req, res) {
    send_data(alarmcode + '2');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({'response': 'Arm command sent to Envisalink.'}));
});

app.get('/api/alarm/stayarm', function(req, res) {
    send_data(alarmcode + '3');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({'response': 'Arm Home command sent to Envisalink.'}));
});

app.get('/api/alarm/chime', function(req, res) {
    send_data(alarmcode + '9');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({'response': 'Chime command sent to Envisalink.'}));
});

app.get('/api/alarm/panic', function(req, res) {
    send_data('B');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({'response': 'Panic command sent to Envisalink.'}));
});

app.get('/api/alarm/disarm', function(req, res) {
    send_data(alarmcode + '1');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({'response': 'Disarm command sent to Envisalink.'}));
});

app.listen(config.alarmserver.listenport);

var client = new net.Socket();
var callbacks = {}

client.connect(config.envisalink.port, config.envisalink.host, function() {
    console.log('Connected');
});

client.on('data', function(input) {
    console.log('RX < "' + input + '"');
    var cmdstr = input.toString('utf8', 0, input.length);

    var cmds = cmdstr.split(/\r?\n/);
    cmds.forEach(function(cmd) {
	var code = cmd;
	if (code) {
	    console.log('code', code);
	    var data = '';
	    if (cmd.charAt(0) == '%' || cmd.charAt(0) == '^') {
		var inputList = cmd.split(',');
		code = inputList[0];
		data = inputList.slice(1).join();
	    }

	    var handler = "handle_" + envisalink.evl_ResponseTypes[code]['handler'];

	    var cb = callbacks[handler];
	    if (cb) {
		cb(data);
	    }
	}
    });
});

client.on('close', function() {
    console.log('Connection closed');
});

function send_data(data) {
    console.log('TX > ', data);
    client.write(data);
}

function send_command(code, data) {
    if (!loggedin) {
        console.log("Not connected to Envisalink - ignoring last command");
        return;
    }
    if (commandinprogress) {
        console.log("Command already in progress - ignoring last command");
        return;
    }
    commandinprogress = true;
    lastcommand = new Date();
    var to_send = '^' + code + ',' + data + '$';
    send_data(to_send);
}

function change_partition(partitionNumber) {
    if (partitionNumber < 1 || partitionNumber > 8) {
        console.log("Invalid Partition Number %i specified when trying to change partition, ignoring.", partitionNumber)
        return;
    }
    send_command('01', partitionNumber);
}

function dump_zone_timers() {
    send_command('02', '')
}

callbacks.handle_login = function handle_login() {
    client.write(config.envisalink.password);
}

callbacks.handle_login_success = function handle_login_success() {
    loggedin = true;
    console.log('Password accepted, session created');
    setTimeout(function() {
	dump_zone_timers();
    }, 5000);
}

callbacks.handle_login_failure = function handle_login_failure() {
    loggedin = false;
    client.close();
    console.log('Password is incorrect. Server is closing socket connection.');
}

callbacks.handle_login_timeout = function handle_login_timeout(data) {
    console.log('Envisalink timed out waiting for password, whoops that should never happen. Server is closing socket connection');
}

callbacks.handle_poll_response = function handle_poll_response(code) {
    lastpollresponse = datetime.now()
    handle_command_response(code);
}

callbacks.handle_command_response = function handle_command_response(code) {
    console.log('handle_command_response', code);
    code = code.substring(0, code.length - 1); 
    commandinprogress = false;
    lastcommandresponse = new Date();
    var responseString = envisalink.evl_TPI_Response_Codes[code];
    console.log("Envisalink response: " + responseString);
    if (code != '00') {
	console.log("error sending command to envisalink.  Response was: " + responseString)
    }
}

callbacks.handle_keypad_update = function handle_keypad_update(data) {
    console.log('handle_keypad_update', data);
    // make sure data is in format we expect, current TPI seems to send bad data every so ofen
    if (data.indexOf('%') != -1) {
        console.log("Data format invalid from Envisalink, ignoring...")
        return;
    }

    var dataList = data.split(',');
    if (dataList.length != 5) {
        console.log("Data format invalid from Envisalink, ignoring...")
        return;
    }
    
    var partitionNumber = parseInt(dataList[0]);
    var flags = parseInt(dataList[1], 16);
    var userOrZone = dataList[2];
    var beep = envisalink.evl_Virtual_Keypad_How_To_Beep[dataList[3]] || 'unknown';
    var alpha = dataList[4];

    extend(ALARMSTATE['partition'][partitionNumber]['status'],
	   {'alarm': (envisalink.evl_IconLEDFlags.alarm & flags) != 0, 'alarm_in_memory': (envisalink.evl_IconLEDFlags.alarm_in_memory & flags) != 0,
	    'armed_away': (envisalink.evl_IconLEDFlags.armed_away & flags) != 0, 'ac_present': (envisalink.evl_IconLEDFlags.ac_present & flags) != 0,
	    'armed_bypass': (envisalink.evl_IconLEDFlags.bypass & flags) != 0, 'chime': (envisalink.evl_IconLEDFlags.chime & flags) != 0,
            'armed_zero_entry_delay': (envisalink.evl_IconLEDFlags.armed_zero_entry_delay & flags) != 0, 'alarm_fire_zone': (envisalink.evl_IconLEDFlags.alarm_fire_zone & flags) != 0,
            'trouble': (envisalink.evl_IconLEDFlags.system_trouble & flags) != 0, 'ready': (envisalink.evl_IconLEDFlags.ready & flags) != 0,
	    'fire': (envisalink.evl_IconLEDFlags.fire & flags) != 0, 'armed_stay': (envisalink.evl_IconLEDFlags.armed_stay & flags) != 0,
            'alpha': alpha,
            'beep': beep,
           });

    var match = /FAULT (\d+)/.exec(alpha);
    if (match) {
	var zoneNumber = parseInt(match[1]);
	var curzonebit = ALARMSTATE['zone'][zoneNumber]['status']['open'];
	if (curzonebit == 0) {
	    extend(ALARMSTATE['zone'][zoneNumber]['status'], {'open': true, 'fault': true});
	    ALARMSTATE['zone'][zoneNumber]['lastevents'].unshift( { message: 'Fault', datetime: new Date() } );
	}
    }
    
        // if we have never yet received a partition state changed event,  we
        // need to compute the armed state ourselves. Don't want to always do
        // it here because we can't also figure out if we are in entry/exit
        // delay from here
    if (!has_partition_state_changed) {
        var armed = (envisalink.evl_IconLEDFlags.armed_away & flags) != 0 || (envisalink.evl_IconLEDFlags.armed_zero_entry_delay & flags) != 0
	    || (envisalink.evl_IconLEDFlags.armed_stay & flags) != 0;
	extend(ALARMSTATE, {'arm': !armed, 'disarm': armed});
        extend(ALARMSTATE['partition'][partitionNumber]['status'], {'armed': armed});
    }
}

callbacks.handle_zone_state_change = function handle_zone_state_change(data) {
    console.log('handle_zone_state_change', data);
    var a = data.match(/./g);
    for (var i = 0; i < a.length; i += 2) {
	var b = a[i];
	a[i] = a[i+1];
	a[i+1] = b;
    }

    var s = a.join('');
    s = s.substring(0, s.length - 1); 
    var state = Buffer.from(s, 'hex');

    for (var property in config.alarmserver.zones) {
	if (config.alarmserver.zones.hasOwnProperty(property)) {
	    var zoneNumber = parseInt(property.replace(/\D+/, ''));
	    var zoneName = config.alarmserver.zones[property];
	    var byte = state[Math.floor(zoneNumber/8)];
	    var zonebit = byte && (1 << (zoneNumber%8));
	    var curzonebit = ALARMSTATE['zone'][zoneNumber]['status']['open'];
	    extend(ALARMSTATE['zone'][zoneNumber]['status'], {'open': zonebit == '1', 'fault': zonebit == '1'});
	    if (zonebit != curzonebit) {
		var message = '';
		if (zonebit == '1') {
		    message = 'Fault';
		} else {
		    message = 'Closed';
		}
		ALARMSTATE['zone'][zoneNumber]['lastevents'].unshift( { message: message, datetime: new Date() } );
	    }
	}
    }
}

callbacks.handle_partition_state_change = function handle_partition_state_change(data) {
    console.log('handle_partition_state_change', data);
}

callbacks.handle_realtime_cid_event = function handle_realtime_cid_event(data) {
    console.log('handle_realtime_cid_event', data);
}

callbacks.handle_zone_timer_dump = function handle_zone_timer_dump(data) {
    console.log('handle_zone_timer_dump', data);
    var a = data.match(/../g);
    for (var i = 0; i < a.length; i += 2) {
	var b = a[i];
	a[i] = a[i+1];
	a[i+1] = b;
    }

    var s = a.join('');
    console.log(s);
    var state = Buffer.from(s, 'hex');

    for (var property in config.alarmserver.zones) {
	if (config.alarmserver.zones.hasOwnProperty(property)) {
	    var zoneNumber = parseInt(property.replace(/\D+/, ''));
	    var zoneName = config.alarmserver.zones[property];

	    var byte1 = state[(zoneNumber-1)*2];
	    var byte2 = state[((zoneNumber-1)*2) + 1];

	    var value = ((byte1 << 8) | byte2);
	    var itemLastClosed;
	    var status;
	    if (value == 0xFFFF) {
		itemLastClosed = "Currently Open";
                status = 'open';
	    } else if (value == 0) {
		itemLastClosed = "Last Closed longer ago than I can remember";
                status = 'closed';
	    } else {
		var itemSeconds = (65536 - ((byte1 << 8) | byte2)) * 5;
		itemLastClosed = moment((new Date()) - (itemSeconds * 1000)).calendar();
		itemLastClosed = "Last Closed " + itemLastClosed;
                status = 'closed';
	    }

	    ALARMSTATE['zone'][zoneNumber]['lastfault'] = itemLastClosed;
	}
    }
}

function extend(target) {
    var sources = [].slice.call(arguments, 1);
    sources.forEach(function (source) {
        for (var prop in source) {
            target[prop] = source[prop];
        }
    });
    return target;
}
