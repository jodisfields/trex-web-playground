const express = require('express');
const http = require('http');
const path = require('path');
const socketIO = require('socket.io');
const { upAll, down, exec } = require('docker-compose/dist/v2');

const app = express();
app.use('/', express.static('client'));

const server = http.createServer(app);
const io = socketIO(server);

io.on('connection', (socket) => {
  // Use docker-compose to start all services defined in the docker-compose.yml file
  upAll({ cwd: path.join(__dirname), log: true })
    .then(() => {
      console.log('docker-compose services started');
      socket.emit('console-output', 'docker-compose services started');
    })
    .catch((err) => {
      console.error('Something went wrong:', err.message);
      socket.emit('console-error', 'Error starting docker-compose services');
    });

  socket.on('console-input', (data) => {
    exec('trex', ['zsh', '-c', data], { cwd: path.join(__dirname) })
      .then((result) => {
        if (result.exitCode === 0) {
          socket.emit('console-output', result.out);
        } else {
          socket.emit('console-output', `Error: ${result.err}`);
        }
      })
      .catch((err) => {
        console.error('Exec command failed:', err.message);
        socket.emit('console-error', `Exec command failed: ${err.message}`);
      });
  });

  socket.on('disconnect', () => {
    // Use docker-compose to stop all services when the user disconnects
    down({ cwd: path.join(__dirname), log: true })
      .then(() => {
        console.log('docker-compose services stopped');
      })
      .catch((err) => {
        console.error('Something went wrong while stopping services:', err.message);
      });
  });
});

server.listen(7171, () => {
  console.log('Server listening on port 7171');
});

process.on('SIGINT', () => {
  // Handle graceful shutdown
  down({ cwd: path.join(__dirname), log: true }).then(() => {
    console.log('docker-compose services stopped due to application shutdown');
    server.close();
    io.close();
    process.exit();
  }).catch((err) => {
    console.error('Something went wrong while stopping services due to application shutdown:', err.message);
    process.exit(1);
  });
});
