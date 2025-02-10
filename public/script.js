const tabId = Date.now() + Math.random().toString(36).substring(7);
const socket = io({
    auth: {
        username: sessionStorage.getItem('username') || 'Guest',
        tabId: tabId
    },
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
});
let gameState = {
    roomId: null,
    symbol: null,
    isMyTurn: false,
    gameActive: false,
    matchCount: 1
};

const board = document.getElementById('board');
const status = document.getElementById('status');
const findGameBtn = document.getElementById('findGame');
const gameOverModal = document.getElementById('gameOverModal');
const gameOverMessage = document.getElementById('gameOverMessage');
const okButton = document.getElementById('okButton');
const livePlayerCount = document.getElementById('livePlayerCount');

let isProcessingClick = false;  // Add this at the top with other state variables

// Initially hide the board
board.style.display = 'none';

findGameBtn.addEventListener('click', () => {
    if (isProcessingClick) return;  // Prevent rapid clicking
    isProcessingClick = true;
    
    setTimeout(() => {
        isProcessingClick = false;
    }, 500);  // Debounce for 500ms

    if (findGameBtn.classList.contains('cancel')) {
        socket.emit('cancelSearch');
        findGameBtn.textContent = 'Find Game';
        findGameBtn.classList.remove('cancel');
        findGameBtn.disabled = true;  // Disable button temporarily
        status.textContent = 'Search cancelled';
        
        setTimeout(() => {
            findGameBtn.disabled = false;
        }, 1000);  // Re-enable after 1 second
    } else {
        findGameBtn.textContent = 'Cancel';
        findGameBtn.classList.add('cancel');
        status.textContent = 'Finding opponent...';
        socket.emit('findGame');
    }
});

socket.on('gameStart', ({ roomId, players, currentTurn }) => {
    console.log('Game started:', { roomId, players, currentTurn });
    
    gameState.roomId = roomId;
    gameState.symbol = players[socket.id];
    gameState.isMyTurn = currentTurn === socket.id;
    gameState.gameActive = true;
    
    findGameBtn.style.display = 'none';
    board.style.display = 'grid';
    clearBoard();
    updateStatus();
    
    // Hide match count at the start of a new game
    if (gameState.matchCount === 1) {
        document.querySelector('.match-stats').style.display = 'none';
    }
});

socket.on('gameUpdate', ({ board: gameBoard, currentTurn }) => {
    console.log('Game updated:', { gameBoard, currentTurn });
    
    gameState.isMyTurn = currentTurn === socket.id;
    updateBoard(gameBoard);
    updateStatus();
});

socket.on('gameOver', ({ winner, board: finalBoard }) => {
    console.log('Game over:', { winner });
    
    gameState.gameActive = false;
    updateBoard(finalBoard);
    
    if (winner === 'draw') {
        gameOverMessage.textContent = "It's a draw! Starting next round...";
        
        // Show match count after the first draw
        document.querySelector('.match-stats').style.display = 'flex';
        
        gameState.matchCount++;
        document.getElementById('matchCount').textContent = `Match: ${gameState.matchCount}`;
        
        gameOverModal.style.display = 'block'; // Show the modal for the draw
        okButton.style.display = 'none'; // Hide the "Okay" button for a draw
        setTimeout(() => {
            socket.emit('startNewRound', { roomId: gameState.roomId });
            gameOverModal.style.display = 'none';
        }, 2000);
    } else {
        gameOverMessage.textContent = winner === gameState.symbol ? 
            'Game Over - You Win!' : 'Game Over - You Lose!';
        gameOverModal.style.display = 'block';
        okButton.style.display = 'block'; // Show the "Okay" button for a win/loss
        
        // Hide match count after a win
        document.querySelector('.match-stats').style.display = 'none';
    }
});

// Update the playerLeft handler
socket.on('playerLeft', () => {
    gameState.gameActive = false;
    status.textContent = 'Opponent disconnected!';
    status.style.color = '#ff4444'; // Red color for disconnect message
    
    // Wait 3 seconds before resetting
    setTimeout(() => {
        status.style.color = 'var(--text)'; // Reset color
        resetGameState();
        status.textContent = 'Waiting for players...';
        gameOverModal.style.display = 'none';
        
        // Ensure the board and match count are hidden
        board.style.display = 'none';
        document.querySelector('.match-stats').style.display = 'none';
        
        // Reset find game button
        findGameBtn.style.display = 'block';
        findGameBtn.disabled = false;
        findGameBtn.textContent = 'Find Game';
        findGameBtn.classList.remove('cancel');
        
        clearBoard();
    }, 3000);
});

// Keep the resetGameState function for other uses
function resetGameState() {
    gameState = {
        roomId: null,
        symbol: null,
        isMyTurn: false,
        gameActive: false,
        matchCount: 1
    };
}

socket.on('searchCancelled', () => {
    findGameBtn.textContent = 'Find Game';
    findGameBtn.classList.remove('cancel');
    findGameBtn.disabled = false;
    status.textContent = 'Search cancelled';
});

socket.on('newRound', ({ board, currentTurn }) => {
    clearBoard();
    gameState.gameActive = true;
    gameState.isMyTurn = currentTurn === socket.id;
    updateStatus();
});

// Update the count handler
socket.on('updateUserCount', (count) => {
    const countElement = document.getElementById('livePlayerCount');
    if (!countElement) return;

    sessionStorage.setItem('lastPlayerCount', count);

    countElement.style.transition = 'opacity 0.3s ease';
    countElement.style.opacity = '0';
    
    setTimeout(() => {
        countElement.textContent = `Live Players: ${count}`;
        countElement.style.opacity = '1';
    }, 300);
});

// Request count on connection and reconnection
socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('requestUserCount');
});

socket.on('reconnect', () => {
    console.log('Reconnected to server');
    socket.emit('requestUserCount');
});

board.addEventListener('click', (e) => {
    if (!gameState.gameActive || !gameState.isMyTurn) return;
    
    const cell = e.target.closest('.cell');
    if (!cell) return;
    
    const symbolSpan = cell.querySelector('.symbol');
    if (cell && !symbolSpan.classList.contains('show')) {
        const index = parseInt(cell.dataset.index);
        // Preview the move locally
        updateCell(cell, gameState.symbol);
        // Send move to server
        socket.emit('makeMove', {
            roomId: gameState.roomId,
            index: index
        });
        gameState.isMyTurn = false;
        updateStatus();
    }
});

function updateCell(cell, symbol) {
    const symbolSpan = cell.querySelector('.symbol');
    symbolSpan.textContent = symbol;
    symbolSpan.setAttribute('data-symbol', symbol);
    symbolSpan.classList.add('show');
}

function updateBoard(gameBoard) {
    const cells = document.getElementsByClassName('cell');
    for (let i = 0; i < cells.length; i++) {
        const symbolSpan = cells[i].querySelector('.symbol');
        if (gameBoard[i] && !symbolSpan.classList.contains('show')) {
            updateCell(cells[i], gameBoard[i]);
        }
    }
}

function clearBoard() {
    const symbols = document.getElementsByClassName('symbol');
    for (let symbol of symbols) {
        symbol.textContent = '';
        symbol.classList.remove('show');
    }
}

function updateStatus() {
    status.textContent = gameState.isMyTurn ? 
        `Your turn (${gameState.symbol})` : 
        `Opponent's turn`;
}

okButton.addEventListener('click', () => {
    gameOverModal.style.display = 'none';
    findGameBtn.style.display = 'block';
    findGameBtn.disabled = false;
    findGameBtn.textContent = 'Find Game';
    findGameBtn.classList.remove('cancel');
    board.style.display = 'none';
    socket.emit('leaveRoom', { roomId: gameState.roomId });
    gameState = {
        roomId: null,
        symbol: null,
        isMyTurn: false,
        gameActive: false,
        matchCount: 1
    };
    status.textContent = 'Waiting for players...';
});

document.addEventListener("DOMContentLoaded", function () {
    const walletBtn = document.querySelector(".wallet-btn");
    const walletPopup = document.getElementById("walletPopup");

    // Function to toggle the wallet popup
    function toggleWalletPopup() {
        walletPopup.classList.toggle("active");
    }

    // Close the wallet popup when clicking outside
    function closeWalletPopup(event) {
        if (!walletPopup.contains(event.target) && !walletBtn.contains(event.target)) {
            walletPopup.classList.remove("active");
        }
    }

    // Attach event listeners
    walletBtn.addEventListener("click", function (event) {
        event.stopPropagation(); // Prevents triggering the close event immediately
        toggleWalletPopup();
    });

    document.addEventListener("click", closeWalletPopup);

    // Optional: Handle deposit and withdraw button clicks
    document.getElementById("deposit").addEventListener("click", function () {
        const amount = parseInt(walletAmount.textContent);
        walletAmount.textContent = amount + 100; // Add 100 to the current balance
        walletMenu.classList.remove('active'); // Close the menu after action
    });

    document.getElementById("withdraw").addEventListener("click", function () {
        const amount = parseInt(walletAmount.textContent);
        if (amount >= 100) {
            walletAmount.textContent = amount - 100; // Subtract 100 from the current balance
        } else {
            alert('Insufficient balance'); // Alert if balance is less than 100
        }
        walletMenu.classList.remove('active'); // Close the menu after action
    });
});

document.addEventListener('DOMContentLoaded', function() {
    // Check if token exists
    const token = sessionStorage.getItem('token');
    if (token) {
        // Verify token with server
        fetch('/verify-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token })
        })
        .then(response => response.json())
        .then(data => {
            if (data.valid) {
                showLoggedInState(data.username);
            } else {
                // Token is invalid, clear storage and show logged out state
                sessionStorage.removeItem('token');
                sessionStorage.removeItem('username');
                showLoggedOutState();
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showLoggedOutState();
        });
    }

    // User menu toggle
    const userBtn = document.querySelector('.user-btn');
    const userPopup = document.getElementById('userPopup');

    if (userBtn) {
        userBtn.addEventListener('click', function(event) {
            event.stopPropagation();
            userPopup.classList.toggle('active');
        });
    }

    // Close user menu when clicking outside
    document.addEventListener('click', function(event) {
        if (!userPopup.contains(event.target) && !userBtn.contains(event.target)) {
            userPopup.classList.remove('active');
        }
    });

    // Logout handler
    document.getElementById('logout').addEventListener('click', function() {
        sessionStorage.removeItem('username');
        sessionStorage.removeItem('token'); // Also remove token
        showLoggedOutState();
    });
});

function showLoggedInState(username) {
    document.getElementById('loginBtn').style.display = 'none';
    document.querySelector('.user-section').style.display = 'flex';
    document.querySelector('.username-display').textContent = username;
}

function showLoggedOutState() {
    document.getElementById('loginBtn').style.display = 'block';
    document.querySelector('.user-section').style.display = 'none';
    window.location.href = 'login.html';
}

// Add reconnection handlers
socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected to server after ' + attemptNumber + ' attempts');
});

socket.on('reconnect_error', (error) => {
    console.log('Reconnection error:', error);
});
