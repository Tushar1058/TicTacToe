const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const rooms = new Map();
const playerQueue = [];
let connectedUsers = 0;

io.on('connection', (socket) => {
    connectedUsers++;
    io.emit('updateUserCount', connectedUsers);

    console.log('User connected:', socket.id);

    socket.on('findGame', () => {
        // Check if player is already in queue
        const existingPlayer = playerQueue.find(player => player.id === socket.id);
        if (existingPlayer) return;
        
        console.log('Player searching for game:', socket.id);
        playerQueue.push({
            id: socket.id,
            socket: socket
        });
        
        if (playerQueue.length >= 2) {
            const player1 = playerQueue.shift();
            const player2 = playerQueue.shift();
            const roomId = `room_${Date.now()}`;
            
            console.log('Creating room:', roomId);
            
            const gameRoom = {
                players: [player1.id, player2.id],
                currentTurn: player1.id,
                board: Array(9).fill(''),
                gameOver: false
            };
            
            rooms.set(roomId, gameRoom);
            player1.socket.join(roomId);
            player2.socket.join(roomId);

            io.to(roomId).emit('gameStart', {
                roomId,
                players: {
                    [player1.id]: 'X',
                    [player2.id]: 'O'
                },
                currentTurn: player1.id
            });
        }
    });

    socket.on('cancelSearch', () => {
        const index = playerQueue.findIndex(player => player.id === socket.id);
        if (index !== -1) {
            playerQueue.splice(index, 1);
            socket.emit('searchCancelled');
        }
    });

    socket.on('makeMove', ({ roomId, index }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameOver) return;

        if (room.currentTurn === socket.id && room.board[index] === '') {
            const symbol = room.players[0] === socket.id ? 'X' : 'O';
            room.board[index] = symbol;
            
            const winner = checkWinner(room.board);
            const isDraw = !room.board.includes('');
            
            if (winner || isDraw) {
                room.gameOver = true;
                io.to(roomId).emit('gameOver', {
                    winner: winner ? symbol : 'draw',
                    board: room.board
                });
            } else {
                room.currentTurn = room.players.find(id => id !== socket.id);
                io.to(roomId).emit('gameUpdate', {
                    board: room.board,
                    currentTurn: room.currentTurn
                });
            }
        }
    });

    socket.on('leaveRoom', ({ roomId }) => {
        socket.leave(roomId);
        rooms.delete(roomId);
    });

    socket.on('disconnect', () => {
        connectedUsers--;
        io.emit('updateUserCount', connectedUsers);

        const queueIndex = playerQueue.findIndex(player => player.id === socket.id);
        if (queueIndex !== -1) {
            playerQueue.splice(queueIndex, 1);
        }

        rooms.forEach((room, roomId) => {
            if (room.players.includes(socket.id)) {
                io.to(roomId).emit('playerLeft');
                rooms.delete(roomId);
            }
        });
    });

    socket.on('startNewRound', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        
        room.board = Array(9).fill('');
        room.gameOver = false;
        room.matchCount++;
        room.currentTurn = room.players[Math.floor(Math.random() * 2)];
        
        io.to(roomId).emit('newRound', {
            board: room.board,
            currentTurn: room.currentTurn
        });
    });
});

function checkWinner(board) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
        [0, 4, 8], [2, 4, 6] // Diagonals
    ];

    for (const [a, b, c] of lines) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return true;
        }
    }
    return false;
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 
