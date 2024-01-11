var express = require('express');
var http = require('http');
var socketio = require('socket.io');
var { exec } = require('child_process');
var fs = require('fs');
var pty = require('node-pty');
var path = require('path');
var tmp = require('tmp');

// Initialize express and http server
var app = express();
app.use("/", express.static("client"));
var server = http.createServer(app).listen(8080);
var io = socketio(server);

console.log("Starting HTTP server...");

io.on('connection', function(socket) {
    console.log("Got new connection");

    // Start Docker Compose service
    exec('docker-compose up -d', (err, stdout, stderr) => {
        if (err) {
            console.error('Error starting services:', stderr);
            return;
        }
        console.log('Services started:', stdout);

        // Create terminal for console
        socket.term = pty.spawn('docker', ['exec', '-it', 'your-console-service', '/etc/startup.sh'], {
            name: 'xterm-color',
            cols: 120,
            rows: 40,
            cwd: process.env.HOME,
            env: process.env
        });

        // Create terminal for code
        socket.code = pty.spawn('docker', ['exec', '-it', 'your-code-service', '/etc/scripts/code.sh'], {
            name: 'xterm-color',
            cols: 120,
            rows: 40,
        });

        // Create terminal for tcpdump
        socket.tcpdump = pty.spawn('docker', ['exec', '-it', 'your-tcpdump-service', 'bash', '-c', '/etc/tcpdump -i veth0'], {
            name: 'xterm-color',
            cols: 120,
            rows: 40,
        });

        var tcp_dump_buffer = Buffer('');

        // Listen on the terminal for output and send it to the client
        socket.tcpdump.on('data', function(data){
            if (tcp_dump_buffer.length < 1024) {
                tcp_dump_buffer += data;
            }
        });

        function publishTCPDump() {
            if (tcp_dump_buffer.length > 0) {
                socket.emit('tcpdump-output', tcp_dump_buffer);
                tcp_dump_buffer = Buffer('');
            }
            setTimeout(publishTCPDump, 500);
        }

        setTimeout(publishTCPDump, 500);

        // Listen on the terminal for output and send it to the client
        socket.term.on('data', function(data){
            socket.emit('console-output', data);
        });

        socket.on('console-input', function(data){
            socket.term.write(data);
        });

        // Listen on the terminal for output and send it to the client
        socket.code.on('data', function(data){
            socket.emit('code-run-output', data);
        });

        socket.on('code-run-input', function(code) {
            if (code == "ESC") {
                socket.code.write(String.fromCharCode(3));
                return;
            }

            // Generate a temporary file
            var tmpobj = tmp.fileSync({ mode: 0644, postfix: '.py', dir: 'shared' });
            fs.writeFileSync(tmpobj.name, code);
            socket.code.write("python " + '/' + tmpobj.name + "\n");
        });

        // When socket disconnects, destroy the terminal
        socket.on("disconnect", function() {
            console.log("Socket disconnected");

            // Stop Docker Compose services
            exec('docker-compose down', (err, stdout, stderr) => {
                if (err) {
                    console.error('Error stopping services:', stderr);
                    return;
                }
                console.log('Services stopped:', stdout);

                // Destroy terminals
                if (socket.term) {
                    socket.term.destroy();
                    socket.term = null;
                }

                if (socket.code) {
                    socket.code.destroy();
                    socket.code = null;
                }

                if (socket.tcpdump) {
                    socket.tcpdump.destroy();
                    socket.tcpdump = null;
                }
            });
        });
    });
});

process.on('SIGINT', function () {
    console.log("\nShutting down...");

    // Shut down Docker Compose environment
    exec('docker-compose down', (err, stdout, stderr) => {
        if (err) {
            console.error('Error stopping services:', stderr);
            return;
        }
        console.log('Services stopped:', stdout);

        // Clean up server and sockets
        server.close();
        io.close();
        process.exit();
    });
});

