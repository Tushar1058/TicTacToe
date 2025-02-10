const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const sqlite3 = require('sqlite3');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const saltRounds = 10;
const jwt = require('jsonwebtoken');
const JWT_SECRET = 'your-secret-key'; // In production, use environment variable
const activeConnections = new Map(); // Track unique connections by tabId
const path = require('path');
let lastBroadcastCount = 0;

app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Use the Railway volume mount path
const dbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'database.sqlite')
    : './users.db';

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to SQLite:', err);
    } else {
        console.log('Connected to SQLite database at', dbPath);
    }
});

// Create table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`, (err) => {
    if (err) {
        console.error('Table creation error:', err.message);
    } else {
        console.log('Users table ready');
    }
});

// Handle signup with password hashing
app.post('/signup', async (req, res) => {
    const { username, email, password } = req.body;

    // Basic validation
    if (!username || !email || !password) {
        return res.status(400).send('Username, email and password are required');
    }

    if (username.length < 3) {
        return res.status(400).send('Username must be at least 3 characters long');
    }

    if (password.length < 6) {
        return res.status(400).send('Password must be at least 6 characters long');
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).send('Please enter a valid email address');
    }

    try {
        // Hash password
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insert new user
        db.run(
            `INSERT INTO users (username, email, password) VALUES (?, ?, ?)`,
            [username, email, hashedPassword],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed: users.username')) {
                        return res.status(400).send('Username already exists');
                    }
                    if (err.message.includes('UNIQUE constraint failed: users.email')) {
                        return res.status(400).send('Email already registered');
                    }
                    console.error(err);
                    return res.status(500).send('Error creating user');
                }
                res.status(201).send('User created');
            }
        );
    } catch (error) {
        console.error(error);
        res.status(500).send('Error creating user');
    }
});

// Handle login with password verification
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).send('Username and password are required');
    }

    db.get(
        `SELECT * FROM users WHERE username = ?`,
        [username],
        async (err, user) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Internal Server Error');
            }

            if (!user) {
                return res.status(401).send('Invalid username or password');
            }

            try {
                const match = await bcrypt.compare(password, user.password);
                if (match) {
                    // Create token
                    const token = jwt.sign(
                        { username: user.username, id: user.id },
                        JWT_SECRET,
                        { expiresIn: '7d' } // Token expires in 7 days
                    );

                    res.status(200).json({
                        message: 'Login successful',
                        isNewUser: false,
                        username: user.username,
                        token: token
                    });
                } else {
                    res.status(401).send('Invalid username or password');
                }
            } catch (error) {
                console.error(error);
                res.status(500).send('Error during login');
            }
        }
    );
});

// Handle password reset request
app.post('/reset-password', (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).send('Email is required');
    }

    // Check if email exists in database
    db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Internal Server Error');
        }

        if (!user) {
            return res.status(404).send('No account found with this email');
        }

        // In a real application, you would:
        // 1. Generate a reset token
        // 2. Save it in the database with an expiration
        // 3. Send an email with a reset link
        // For now, we'll just send a success message
        res.status(200).send('Reset link sent');
    });
});

// Add this new endpoint to verify token
app.post('/verify-token', (req, res) => {
    const token = req.body.token;
    if (!token) {
        return res.status(401).json({ valid: false });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json({ 
            valid: true, 
            username: decoded.username 
        });
    } catch (err) {
        res.status(401).json({ valid: false });
    }
});

const rooms = new Map();
const playerQueue = [];
let connectedUsers = 0;

// Function to get the actual connection count
function getActualConnectionCount() {
    const uniqueTabs = new Set();
    
    for (const [_, conn] of activeConnections.entries()) {
        uniqueTabs.add(conn.tabId);
    }
    
    return uniqueTabs.size;
}

// Broadcast count to all clients
function broadcastCount() {
    const currentCount = getActualConnectionCount();
    if (currentCount !== lastBroadcastCount) {
        lastBroadcastCount = currentCount;
        io.emit('updateUserCount', currentCount);
    }
}

io.on('connection', (socket) => {
    const username = socket.handshake.auth.username || 'Guest';
    const tabId = socket.handshake.auth.tabId;
    
    // Store connection info
    activeConnections.set(socket.id, {
        username,
        tabId,
        timestamp: Date.now()
    });

    console.log(`New connection: ${username} (${socket.id}) - Tab: ${tabId}`);
    
    // Broadcast count immediately after new connection
    broadcastCount();

    // Handle count requests
    socket.on('requestUserCount', () => {
        socket.emit('updateUserCount', getActualConnectionCount());
    });

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
        console.log(`Disconnection: ${username} (${socket.id}) - Tab: ${tabId}`);
        activeConnections.delete(socket.id);
        broadcastCount();

        // Find and cleanup any rooms this player was in
        rooms.forEach((room, roomId) => {
            if (room.players.includes(socket.id)) {
                // Notify other player
                socket.to(roomId).emit('playerLeft');
                // Clean up the room
                rooms.delete(roomId);
            }
        });

        // Also remove from queue if disconnected while searching
        const queueIndex = playerQueue.findIndex(player => player.id === socket.id);
        if (queueIndex !== -1) {
            playerQueue.splice(queueIndex, 1);
        }
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

    // Clean up on errors
    socket.on('error', () => {
        activeConnections.delete(socket.id);
        broadcastCount();
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

// Start the server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 
