require('dotenv').config();
const express = require('express');
const session = require('express-session');
const app = express();

// Add session middleware BEFORE creating server and socket.io
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
}));

const server = require('http').createServer(app);
const io = require('socket.io')(server, {
    pingTimeout: 60000,
    pingInterval: 25000
});

// Socket.IO session handling
io.engine.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false
}));

const cors = require('cors');
const sqlite3 = require('sqlite3');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const saltRounds = 10;
const jwt = require('jsonwebtoken');
const JWT_SECRET = 'your-secret-key'; // Use environment variable in production
const activeConnections = new Map(); // Track unique connections by tabId
const path = require('path');

// Add these at the top with other state tracking
let waitingPlayers = new Map(); // Track players waiting for a match
let gameRooms = new Map(); // Track active game rooms
let activeGames = new Set(); // Track active game sessions

// Add these near the top with other state variables
let lastEmittedCount = 0;
let connectedUsers = new Map();

// Near the top of the file, after requires
let isShuttingDown = false;

app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// CORS configuration
app.use(cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
    credentials: true
}));

// Use the Railway volume mount path with better error handling
const dbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'database.sqlite')
    : path.join(__dirname, 'users.db');

console.log('Using database path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to SQLite:', err);
        process.exit(1); // Exit if we can't connect to the database
    } else {
        console.log('Connected to SQLite database at', dbPath);
    }
});

// Database initialization with better error handling
db.serialize(() => {
    try {
        // First create the users table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT UNIQUE,
            password TEXT,
            wallet_amount INTEGER DEFAULT 1000,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('Table creation error:', err.message);
            } else {
                console.log('Users table ready');
            }
        });

        // Then add wallet_amount column if it doesn't exist
        db.run(`
            ALTER TABLE users 
            ADD COLUMN wallet_amount INTEGER DEFAULT 1000;
        `, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('Error adding wallet_amount column:', err.message);
            }
        });

        // Update existing users to have default wallet amount if they don't have it
        db.run(`
            UPDATE users 
            SET wallet_amount = 1000 
            WHERE wallet_amount IS NULL
        `, (err) => {
            if (err) {
                console.error('Error updating existing users:', err.message);
            }
        });
    } catch (err) {
        console.error('Database initialization error:', err);
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
                    const token = jwt.sign(
                        { username: user.username, id: user.id },
                        JWT_SECRET,
                        { expiresIn: '7d' }
                    );

                    res.status(200).json({
                        message: 'Login successful',
                        isNewUser: false,
                        username: user.username,
                        token: token,
                        wallet_amount: user.wallet_amount
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

// Add this function to handle wallet updates
function broadcastWalletUpdate(username, newBalance) {
    io.to(username).emit('wallet-update', newBalance);
}

// Add this function at the top level of server.js
async function getWalletBalance(username) {
    return new Promise((resolve, reject) => {
        db.get(
            'SELECT wallet_amount FROM users WHERE username = ?',
            [username],
            (err, user) => {
                if (err) {
                    console.error('Database error:', err);
                    reject(err);
                } else if (!user) {
                    reject(new Error('User not found'));
                } else {
                    resolve(user.wallet_amount);
                }
            }
        );
    });
}

// Track players who are ready to leave after game end
const playersReadyToLeave = new Map(); // Change to Map to track by roomId

io.on('connection', (socket) => {
    const isLoggedIn = socket.handshake.auth.isLoggedIn;
    const username = socket.handshake.auth.username;
    const tabId = socket.handshake.auth.tabId;

    // Remove the initial game check on connection
    if (isLoggedIn) {
        const existingConnections = Array.from(connectedUsers.values())
            .filter(user => user.username === username && user.isLoggedIn);
            
        if (existingConnections.length === 0) {
            // First connection for this logged-in user
            connectedUsers.set(socket.id, { username, tabId, isLoggedIn });
        } else {
            // Additional tab for existing logged-in user
            connectedUsers.set(socket.id, { username, tabId, isLoggedIn });
        }
    } else {
        // Guest user - count each connection
        connectedUsers.set(socket.id, { username, tabId, isLoggedIn });
    }

    // Update count for all clients
    updateUserCount();
    io.emit('updateUserCount', getLiveCount());

    socket.on('findGame', () => {
        const currentPlayer = {
            id: socket.id,
            username: socket.handshake.auth.username,
            isLoggedIn: socket.handshake.auth.isLoggedIn
        };

        if (waitingPlayers.size > 0) {
            const opponentId = waitingPlayers.keys().next().value;
            const opponent = waitingPlayers.get(opponentId);

            // Check for self-play
            if (currentPlayer.isLoggedIn && opponent.isLoggedIn && 
                currentPlayer.username === opponent.username) {
                socket.emit('selfPlayError', {
                    message: 'You cannot play against yourself'
                });
                return;
            }

            const roomId = `room_${Date.now()}`;
            
            // Create room with initial betting phase
            gameRooms.set(roomId, {
                players: [
                    {
                        id: socket.id,
                        username: currentPlayer.username,
                        isLoggedIn: currentPlayer.isLoggedIn,
                        betPlaced: false,
                        betAmount: 0
                    },
                    {
                        id: opponentId,
                        username: opponent.username,
                        isLoggedIn: opponent.isLoggedIn,
                        betPlaced: false,
                        betAmount: 0
                    }
                ],
                board: Array(9).fill(null),
                currentTurn: null, // Will be set after betting phase
                gameStarted: false,
                bettingPhase: true
            });

            // Remove from waiting list
            waitingPlayers.delete(opponentId);
            waitingPlayers.delete(socket.id);

            // Notify both players to enter betting phase
            io.to(socket.id).emit('enterBettingLobby', { roomId });
            io.to(opponentId).emit('enterBettingLobby', { roomId });
        } else {
            waitingPlayers.set(socket.id, currentPlayer);
        }
    });

    socket.on('makeMove', ({ roomId, index, symbol }) => {
        const room = gameRooms.get(roomId);
        if (!room || room.currentTurn !== socket.id || room.board[index] !== null) {
            return;
        }

        // Update the board with the player's symbol
        room.board[index] = symbol;
        
        const winner = checkWinner(room.board);
        const isDraw = !winner && room.board.every(cell => cell !== null);

        if (winner) {
            const winningPlayer = room.players.find(p => p.symbol === winner);
            if (winningPlayer && winningPlayer.isLoggedIn) {
                // Update winner's wallet and emit balance update
                updateWalletBalance(winningPlayer.username, winningPlayer.betAmount * 2)
                    .then(newBalance => {
                        io.to(winningPlayer.id).emit('wallet-update', newBalance);
                        console.log(`Winner ${winningPlayer.username} received ${winningPlayer.betAmount * 2}. New balance: ${newBalance}`);
                    })
                    .catch(err => {
                        console.error('Failed to process winnings:', err);
                    });
            }
        }
        
        if (winner || isDraw) {
            if (isDraw) {
                // For draw, reset the board and switch turns
                room.board = Array(9).fill(null);
                room.gameStarted = true;
                room.bettingPhase = false;
                
                // Get the current and next players
                const currentPlayer = room.players.find(p => p.id === room.currentTurn);
                const nextPlayer = room.players.find(p => p.id !== room.currentTurn);
                room.currentTurn = nextPlayer.id;  // Switch turns for next round
                
                room.players.forEach(player => {
                    io.to(player.id).emit('gameOver', {
                        winner: 'draw',
                        board: room.board,
                        currentTurn: room.currentTurn,
                        newRound: true
                    });
                });

                // Emit a separate newRound event to ensure turn order is updated
                room.players.forEach(player => {
                    io.to(player.id).emit('newRound', {
                        board: room.board,
                        currentTurn: room.currentTurn
                    });
                });
            } else {
                // Handle win/loss case
                room.gameEnded = true;
                room.players.forEach(player => {
                    io.to(player.id).emit('gameOver', {
                        winner,
                        board: room.board,
                        newRound: false
                    });
                });
            }
        } else {
            // Regular move - switch turns
            room.currentTurn = room.players.find(p => p.id !== socket.id).id;
            
            room.players.forEach(player => {
                io.to(player.id).emit('gameUpdate', {
                    board: room.board,
                    currentTurn: room.currentTurn
                });
            });

            // Update betting container state based on the current turn
        }
    });

    socket.on('startNewRound', ({ roomId }) => {
        const room = gameRooms.get(roomId);
        if (!room) return;

        // Reset the board
        room.board = Array(9).fill(null);
        
        // Switch who goes first in the new round
        const currentPlayer = room.players.find(p => p.id === room.currentTurn);
        const nextPlayer = room.players.find(p => p.id !== room.currentTurn);
        room.currentTurn = nextPlayer.id;

        // Notify both players of the new round
        room.players.forEach(player => {
            io.to(player.id).emit('newRound', {
                board: room.board,
                currentTurn: room.currentTurn
            });
        });
    });

    socket.on('cancelSearch', () => {
        waitingPlayers.delete(socket.id);
    });

    socket.on('playerReadyToLeave', ({ roomId }) => {
        const room = gameRooms.get(roomId);
        if (!room) return;

        const username = socket.handshake.auth.username;
        const isLoggedIn = socket.handshake.auth.isLoggedIn;
        const playerId = isLoggedIn ? username : socket.id;

        // Initialize Set for this room if it doesn't exist
        if (!playersReadyToLeave.has(roomId)) {
            playersReadyToLeave.set(roomId, new Set());
        }

        // Add this player to ready-to-leave set for this room
        playersReadyToLeave.get(roomId).add(socket.id);

        const currentPlayer = room.players.find(p => {
            const playerIdentifier = p.isLoggedIn ? p.username : p.id;
            return playerIdentifier === playerId;
        });

        if (!currentPlayer) return;

        const otherPlayer = room.players.find(p => p !== currentPlayer);
        
        if (otherPlayer) {
            io.to(otherPlayer.id).emit('opponentReadyToLeave', {
                message: 'Opponent is ready to leave the game',
                roomId: roomId
            });
        }

        // Check if both players are ready to leave this specific room
        const readyPlayers = playersReadyToLeave.get(roomId);
        const allPlayersReady = room.players.every(p => readyPlayers.has(p.id));

        if (allPlayersReady) {
            // Clean up room
            activeGames.delete(roomId);
            gameRooms.delete(roomId);
            playersReadyToLeave.delete(roomId);
            
            // Notify all players to leave
            room.players.forEach(p => {
                io.to(p.id).emit('bothPlayersLeft', { roomId });
                socket.leave(roomId);
            });
        }
    });

    socket.on('leaveRoom', ({ roomId }) => {
        const room = gameRooms.get(roomId);
        if (!room) return;

        // If game is ended, use playerReadyToLeave logic instead
        if (room.gameEnded) {
            socket.emit('useReadyToLeave', { roomId });
            return;
        }

        // For mid-game leaves
        const otherPlayer = room.players.find(p => p.id !== socket.id);
        if (otherPlayer) {
            io.to(otherPlayer.id).emit('opponentLeft', {
                message: 'Game ended - Opponent left',
                isGameOver: true
            });
        }

        // Clean up room
        activeGames.delete(roomId);
        gameRooms.delete(roomId);
        if (playersReadyToLeave.has(roomId)) {
            playersReadyToLeave.delete(roomId);
        }
        
        socket.leave(roomId);
    });

    socket.on('placeBet', async ({ roomId, betAmount }) => {
        const room = gameRooms.get(roomId);
        if (!room || !room.bettingPhase) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || player.betPlaced) return;

        if (player.isLoggedIn) {
            try {
                const currentBalance = await getWalletBalance(player.username);

                if (currentBalance < betAmount) {
                    socket.emit('betError', { message: 'Insufficient balance' });
                    return;
                }

                player.betAmount = betAmount;
                player.betPlaced = true;

                room.players.forEach(p => {
                    io.to(p.id).emit('updateBettingInfo', {
                        players: room.players.map(player => ({
                            id: player.id,
                            username: player.username || 'Guest',
                            betAmount: player.betAmount || 0,
                            betPlaced: player.betPlaced
                        }))
                    });
                });

                const opponent = room.players.find(p => p.id !== socket.id);
                if (opponent) {
                    io.to(opponent.id).emit('opponentBetPlaced', {
                        message: 'Opponent placed their bet',
                        opponentBetAmount: betAmount
                    });
                }

                if (room.players.every(p => p.betPlaced)) {
                    const [player1, player2] = room.players;
                    if (player1.betAmount !== player2.betAmount) {
                        room.players.forEach(p => {
                            io.to(p.id).emit('betError', { message: 'Bets do not match' });
                        });
                        return;
                    }

                    
                    for (const p of room.players) {
                        const newBalance = await updateWalletBalance(p.username, -p.betAmount);
                        io.to(p.id).emit('wallet-update', newBalance);
                        console.log(`Deducted ${p.betAmount} from ${p.username}'s wallet. New balance: ${newBalance}`);
                    }

                    room.players.forEach(p => {
                        io.to(p.id).emit('bothBetsPlaced');
                    });

                    room.bettingPhase = false;
                    room.gameStarted = true;
                    room.currentTurn = room.players[Math.floor(Math.random() * 2)].id;

                    room.players[0].symbol = Math.random() < 0.5 ? 'X' : 'O';
                    room.players[1].symbol = room.players[0].symbol === 'X' ? 'O' : 'X';

                    const symbols = {
                        [room.players[0].id]: room.players[0].symbol,
                        [room.players[1].id]: room.players[1].symbol
                    };

                    room.players.forEach(p => {
                        io.to(p.id).emit('gameStart', {
                            roomId,
                            players: symbols,
                            currentTurn: room.currentTurn,
                            bets: {
                                [room.players[0].id]: room.players[0].betAmount,
                                [room.players[1].id]: room.players[1].betAmount
                            }
                        });
                    });
                }
            } catch (err) {
                console.error('Failed to process bet:', err);
                socket.emit('betError', { message: 'Failed to place bet' });
            }
        }
    });

    socket.on('betMenuLeave', ({ roomId }) => {
        const room = gameRooms.get(roomId);
        if (!room) return;

        const otherPlayer = room.players.find(p => p.id !== socket.id);
        if (otherPlayer) {
            io.to(otherPlayer.id).emit('opponentLeftLobby', {
                message: 'Opponent left the lobby',
                isFromBetMenu: true
            });
        }

        // Notify the player who left
        socket.emit('opponentLeftLobby', {
            message: 'You left the lobby',
            isFromBetMenu: true
        });

        // Clean up room
        activeGames.delete(roomId);
        gameRooms.delete(roomId);
        socket.leave(roomId);
    });

    socket.on('checkGameStatus', ({ username, isLoggedIn }) => {
        const isInGame = Array.from(gameRooms.values()).some(room => 
            room.players.some(p => 
                (isLoggedIn && p.isLoggedIn && p.username === username) || 
                (!isLoggedIn && p.id === socket.id)
            )
        );
        
        socket.emit('gameStatusResponse', { isInGame });
    });

    socket.on('clearBet', ({ roomId }) => {
        const room = gameRooms.get(roomId);
        if (!room || !room.bettingPhase) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        // Clear player's bet
        player.betPlaced = false;
        player.betAmount = 0;

        // Update betting info for all players
        room.players.forEach(p => {
            io.to(p.id).emit('updateBettingInfo', {
                players: room.players.map(player => ({
                    id: player.id,
                    username: player.username || 'Guest',
                    betAmount: player.betAmount || 0,
                    betPlaced: player.betPlaced
                }))
            });
        });

        // Notify other player about bet clearing
        const opponent = room.players.find(p => p.id !== socket.id);
        if (opponent) {
            io.to(opponent.id).emit('opponentClearedBet', {
                opponentHasBet: opponent.betPlaced
            });
        }
    });

    socket.on('gameWon', async ({ winner, roomId }) => {
        const room = gameRooms.get(roomId);
        if (!room) return;
        
        const winningPlayer = room.players.find(p => p.symbol === winner);

        if (winningPlayer && winningPlayer.isLoggedIn) {
            try {
                // Calculate winnings (double the bet amount)
                const winnings = winningPlayer.betAmount * 2;
                
                // Update winner's wallet
                const newBalance = await updateWalletBalance(winningPlayer.username, winnings);
                
                // Emit the updated balance to the winner
                io.to(winningPlayer.id).emit('wallet-update', newBalance);
                console.log(`Winner ${winningPlayer.username} received ${winnings}. New balance: ${newBalance}`);
            } catch (err) {
                console.error('Failed to process winnings:', err);
            }
        }

        // Notify both players of game end
        room.players.forEach(player => {
            io.to(player.id).emit('gameOver', {
                winner,
            board: room.board,
                roomId
            });
        });

        // Mark room as ended
        room.gameEnded = true;
    });

    socket.on('disconnect', () => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            // Handle user tracking cleanup
            if (user.isLoggedIn) {
                const remainingConnections = Array.from(connectedUsers.values())
                    .filter(u => u.username === user.username && u.isLoggedIn);
                
                if (remainingConnections.length <= 1) {
                    connectedUsers.delete(socket.id);
                    updateUserCount();
                } else {
                    connectedUsers.delete(socket.id);
                }
            } else {
                connectedUsers.delete(socket.id);
                updateUserCount();
            }
        }

        // Handle game-related disconnection
        waitingPlayers.delete(socket.id);
        
        // Check for active games and handle disconnection
        for (const [roomId, room] of gameRooms.entries()) {
            if (room.players.some(p => p.id === socket.id)) {
                const opponent = room.players.find(p => p.id !== socket.id);
                const disconnectedPlayer = room.players.find(p => p.id === socket.id);
                
                if (opponent) {
                    let disconnectMessage;
                    
                    if (room.gameStarted) {
                        disconnectMessage = {
                            message: 'Opponent disconnected from the game!',
                            inGame: true,
                            inBettingPhase: false,
                            roomId
                        };

                        // Only revert bet amount to the opponent who stayed
                        if (opponent.isLoggedIn && opponent.betAmount) {
                            updateWalletBalance(opponent.username, opponent.betAmount)
                                .then(newBalance => {
                                    io.to(opponent.id).emit('wallet-update', newBalance);
                                    console.log(`Reverted ${opponent.betAmount} to ${opponent.username}'s wallet. New balance: ${newBalance}`);
                                })
                                .catch(err => {
                                    console.error('Failed to revert bet amount:', err);
                                });
                        }

                        // Log the disconnected player's forfeit
                        if (disconnectedPlayer.isLoggedIn) {
                            console.log(`${disconnectedPlayer.username} forfeited their bet of ${disconnectedPlayer.betAmount} by disconnecting`);
                        }
                    } else if (room.bettingPhase) {
                        disconnectMessage = {
                            message: 'Opponent disconnected during betting phase!',
                            inGame: false,
                            inBettingPhase: true,
                            roomId
                        };
                    } else {
                        disconnectMessage = {
                            message: 'Opponent disconnected from the lobby!',
                            inGame: false,
                            inBettingPhase: false,
                            roomId
                        };
                    }
                    
                    io.to(opponent.id).emit('opponentDisconnected', disconnectMessage);
                }
                
                // Clean up the room
                activeGames.delete(roomId);
                gameRooms.delete(roomId);
            }
        }
    });
});

function checkDraw(board) {
    return board.every(cell => cell !== null);
}

function checkWinner(board) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
        [0, 4, 8], [2, 4, 6] // Diagonals
    ];

    for (let line of lines) {
        const [a, b, c] = line;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    return null;
}

// Endpoint to get wallet amount
app.get('/wallet-amount', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        db.get('SELECT wallet_amount FROM users WHERE username = ?', 
            [decoded.username], 
            (err, row) => {
                if (err) {
                    return res.status(500).json({ error: 'Database error' });
                }
                if (!row) {
                    return res.status(404).json({ error: 'User not found' });
                }
                res.json({ amount: row.wallet_amount });
            }
        );
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// Update the verify-token endpoint
app.post('/verify-token', async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
        return res.json({ valid: false });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Get user data including wallet balance
        db.get(
            'SELECT username, wallet_amount FROM users WHERE username = ?',
            [decoded.username],
            (err, user) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.json({ valid: false });
                }

                if (!user) {
                    return res.json({ valid: false });
                }

                // Send back user data including wallet balance
                res.json({
                    valid: true,
                    username: user.username,
                    wallet_amount: user.wallet_amount
                });

                // Also emit wallet update through socket
                io.to(user.username).emit('wallet-update', user.wallet_amount);
            }
        );
    } catch (err) {
        console.error('Token verification failed:', err);
        res.json({ valid: false });
    }
});

// Update the wallet update endpoint
app.post('/update-wallet', async (req, res) => {
    const { username, amount } = req.body;
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        if (decoded.username !== username) {
            return res.status(401).json({ error: 'Unauthorized access' });
        }

        if (amount < 0) {
            const currentBalance = await getWalletBalance(username);
            if (currentBalance + amount < 0) {
                return res.status(400).json({ error: 'Insufficient balance' });
            }
        }

        db.run(
            'UPDATE users SET wallet_amount = wallet_amount + ? WHERE username = ?',
            [amount, username],
            async function(err) {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ error: 'Database error' });
                }

                try {
                    const newBalance = await getWalletBalance(username);
                    io.to(username).emit('wallet-update', newBalance);
                    res.json({ success: true, balance: newBalance });
                } catch (err) {
                    console.error('Error fetching updated wallet balance:', err);
                    res.status(500).json({ error: 'Error fetching balance' });
                }
            }
        );
    } catch (err) {
        console.error('Token verification failed:', err);
        res.status(401).json({ error: 'Invalid token' });
    }
});

// Update the debounce function and updateUserCount
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

const updateUserCount = debounce(() => {
    const uniqueLoggedInUsers = new Set();
    const guestCount = Array.from(connectedUsers.values())
        .filter(user => !user.isLoggedIn).length;
    
    // Count logged-in users only once
    connectedUsers.forEach(user => {
        if (user.isLoggedIn) {
            uniqueLoggedInUsers.add(user.username);
        }
    });
    
    const totalCount = uniqueLoggedInUsers.size + guestCount;
    
    // Only emit if there's a real change in unique users
    if (totalCount !== lastEmittedCount) {
        lastEmittedCount = totalCount;
        io.emit('updateUserCount', totalCount);
    }
}, 100);

// Add a function to get actual connection count
function getActualConnectionCount() {
    const uniqueTabs = new Set();
    
    for (const [_, conn] of activeConnections.entries()) {
        uniqueTabs.add(conn.tabId);
    }
    
    return uniqueTabs.size;
}

// Broadcast count to all clients
function broadcastCount() {
    const totalCount = getActualConnectionCount();
    if (totalCount !== lastEmittedCount) {
        lastEmittedCount = totalCount;
        io.emit('updateUserCount', totalCount);
    }
}

// Function to get accurate live count
function getLiveCount() {
    const uniqueUsers = new Set();
    
    for (const user of connectedUsers.values()) {
        if (user.isLoggedIn) {
            uniqueUsers.add(user.username);
        } else {
            uniqueUsers.add(user.tabId);
        }
    }
    
    return uniqueUsers.size;
}

// Function to update wallet balance
async function updateWalletBalance(username, amount) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION', (err) => {
                if (err) {
                    console.error('Error starting transaction:', err);
                    reject(err);
                    return;
                }

                db.run(
                    'UPDATE users SET wallet_amount = wallet_amount + ? WHERE username = ?',
                    [amount, username],
                    function(err) {
                        if (err) {
                            db.run('ROLLBACK', (rollbackErr) => {
                                if (rollbackErr) {
                                    console.error('Error during rollback:', rollbackErr);
                                }
                                console.error('Error updating wallet balance:', err);
                                reject(err);
                            });
                            return;
                        }

                        db.get(
                            'SELECT wallet_amount FROM users WHERE username = ?',
                            [username],
                            (err, row) => {
                                if (err) {
                                    db.run('ROLLBACK', (rollbackErr) => {
                                        if (rollbackErr) {
                                            console.error('Error during rollback:', rollbackErr);
                                        }
                                        console.error('Error getting updated balance:', err);
                                        reject(err);
                                    });
                                    return;
                                }

                                db.run('COMMIT', (commitErr) => {
                                    if (commitErr) {
                                        console.error('Error during commit:', commitErr);
                                        reject(commitErr);
                                        return;
                                    }
                                    resolve(row.wallet_amount);
                                });
                            }
                        );
                    }
                );
            });
        });
    });
}

// Graceful shutdown handling
function gracefulShutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log('Received shutdown signal. Starting graceful shutdown...');
    
    // Stop accepting new connections
    server.close(() => {
        console.log('Server closed. Closing database...');
        
        // Close database connection
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
                process.exit(1);
            }
            console.log('Database connection closed.');
            process.exit(0);
        });
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 30000);
}

// Process handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    gracefulShutdown();
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown();
});

// Update the server start
const PORT = process.env.PORT || 3000;
try {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
    });
} catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
}

// Socket.IO error handling
io.on('connect_error', (error) => {
    console.error('Socket.IO connection error:', error);
});

io.on('error', (error) => {
    console.error('Socket.IO error:', error);
});

