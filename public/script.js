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

// Initial setup for live player count
document.addEventListener('DOMContentLoaded', () => {
    const countElement = document.getElementById('livePlayerCount');
    if (countElement) {
        countElement.innerHTML = 'Live Players: <div class="number">0</div>';
    }
});

let lastCount = 0;
let isInitialCount = true;
let lastConnectTime = 0;
const RECONNECT_THRESHOLD = 2000; // 2 seconds threshold

socket.on('connect', () => {
    console.log('Connected to server');
    const currentTime = Date.now();
    
    // Only emit connection if enough time has passed since last connection
    if (currentTime - lastConnectTime > RECONNECT_THRESHOLD) {
        socket.emit('playerConnected');
        lastConnectTime = currentTime;
    }
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    socket.emit('playerDisconnected');
});

socket.on('updateUserCount', (count) => {
    const countElement = document.getElementById('livePlayerCount');
    if (!countElement) return;

    const numberElement = countElement.querySelector('.number');
    const currentCount = parseInt(numberElement?.textContent || '0');

    if (isInitialCount) {
        numberElement.textContent = count;
        lastCount = count;
        isInitialCount = false;
        return;
    }

    if (count > lastCount) {
        numberElement.classList.add('updating', 'up');
        setTimeout(() => {
            numberElement.textContent = count;
            setTimeout(() => {
                numberElement.classList.remove('updating', 'up');
            }, 300);
        }, 200);
    } else if (count < lastCount) {
        numberElement.classList.add('updating', 'down');
        setTimeout(() => {
            numberElement.textContent = count;
            setTimeout(() => {
                numberElement.classList.remove('updating', 'down');
            }, 300);
        }, 200);
    }
    lastCount = count;
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

// Move these outside DOMContentLoaded to make them globally accessible
let currentWalletAmount = 0;
let walletPopup = null;
function makeDraggable(element) {
    let offsetX = 0, offsetY = 0, startX = 0, startY = 0;
    const header = element.querySelector('.wallet-header');

    if (!header) return;

    header.addEventListener('mousedown', dragMouseDown);
    let isDragging = false;

    function dragMouseDown(e) {
        if (window.innerWidth <= 768) return; // Disable on mobile
        if (e.target.classList.contains('close-btn')) return; // Don't drag if clicking close button
        
        e.preventDefault();
        isDragging = true;

        startX = e.clientX;
        startY = e.clientY;

        // Get computed transform values
        const style = window.getComputedStyle(element);
        const matrix = new DOMMatrix(style.transform);

        offsetX = matrix.m41 || 0;
        offsetY = matrix.m42 || 0;

        element.classList.add('dragging');

        document.addEventListener('mousemove', elementDrag);
        document.addEventListener('mouseup', closeDragElement);
    }

    function elementDrag(e) {
        if (!isDragging) return;
        e.preventDefault();

        let newX = offsetX + (e.clientX - startX);
        let newY = offsetY + (e.clientY - startY);

        // Get screen dimensions
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        // Get element dimensions
        const rect = element.getBoundingClientRect();
        const elementWidth = rect.width;
        const elementHeight = rect.height;

        // Adjust boundaries - much more to left, much less to right
        const minX = -elementWidth * 1.5;  // Allow 1.5x width beyond left
        const maxX = screenWidth - elementWidth * 1.95;  // Keep only half width visible on right
        const minY = 0;  // Keep top within screen
        const maxY = screenHeight - elementHeight;  // Keep bottom within screen

        // Keep menu within adjusted bounds
        newX = Math.max(minX, Math.min(newX, maxX));
        newY = Math.max(minY, Math.min(newY, maxY));

        requestAnimationFrame(() => {
            element.style.transform = `translate(${newX}px, ${newY}px)`;
        });
    }

    function closeDragElement() {
        isDragging = false;
        element.classList.remove('dragging');
        document.removeEventListener('mousemove', elementDrag);
        document.removeEventListener('mouseup', closeDragElement);
    }
}

document.addEventListener("DOMContentLoaded", function() {
    const walletBtn = document.querySelector(".wallet-btn");
    const walletMenu = document.getElementById("walletPopup");
    const closeBtn = walletMenu.querySelector(".close-btn");

    if (walletBtn && walletMenu) {
        makeDraggable(walletMenu);

        walletBtn.addEventListener("click", function(e) {
            e.stopPropagation();
            if (!walletMenu.classList.contains("active")) {
                walletMenu.classList.add("active");
                walletMenu.style.display = 'block';
                walletMenu.style.transform = '';
                walletMenu.style.left = '';
                walletMenu.style.top = '';
                walletMenu.style.right = '0';
            }
        });

        closeBtn.addEventListener("click", function() {
            walletMenu.classList.remove("active");
            walletMenu.style.display = 'none';
        });

        // Add deposit handler
        document.getElementById("deposit").addEventListener("click", function() {
            const token = sessionStorage.getItem('token');
            if (!token) {
                showWalletNotification('Please log in to update wallet');
                return;
            }

            const amount = parseInt(document.getElementById('walletInputAmount').value);

            if (!amount || isNaN(amount) || amount < 100) {
                showWalletNotification('Please enter an amount of at least ₹100');
                return;
            }

            if (amount > 10000) {
                showWalletNotification('Maximum deposit amount is ₹10,000');
                return;
            }

            if (amount > 10000) {
                showWalletNotification('This deposit would exceed the maximum wallet limit (₹10,000)');
                return;
            }

            const newAmount = currentWalletAmount + amount;
            
            fetch('/update-wallet', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ amount: newAmount })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    currentWalletAmount = data.amount;
                    updateWalletDisplay(data.amount);
                    document.getElementById('walletInputAmount').value = '';
                    showWalletNotification(`₹${amount} deposited successfully!`, 'success');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showWalletNotification('Failed to update wallet');
            });
        });

        // Update withdraw handler
        document.getElementById("withdraw").addEventListener("click", function() {
            const token = sessionStorage.getItem('token');
            if (!token) {
                showWalletNotification('Please log in to update wallet');
                return;
            }

            const amount = parseInt(document.getElementById('walletInputAmount').value);

            if (!amount || isNaN(amount) || amount < 100) {
                showWalletNotification('Please enter an amount of at least ₹100');
                return;
            }

            if (amount > 10000) {
                showWalletNotification('Maximum withdrawal amount is ₹10,000');
                return;
            }

            if (amount > currentWalletAmount) {
                showWalletNotification(`Insufficient balance (Current balance: ₹${currentWalletAmount})`);
                return;
            }

            const newAmount = currentWalletAmount - amount;
            
            fetch('/update-wallet', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ amount: newAmount })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    currentWalletAmount = data.amount;
                    updateWalletDisplay(data.amount);
                    document.getElementById('walletInputAmount').value = '';
                    showWalletNotification(`₹${amount} withdrawn successfully!`, 'success');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showWalletNotification('Failed to update wallet');
            });
        });
    }

    loadWalletAmount();

    // Get all elements with wallet amount and animate them
    const walletAmount = document.getElementById('walletDisplayAmount');
    if (walletAmount) {
        countUp(walletAmount);
    }
});

// Keep these functions outside DOMContentLoaded
function showWalletNotification(message, type = 'error') {
    const notification = document.getElementById('walletNotification');
    notification.textContent = message;
    notification.className = `wallet-notification ${type}`;
    
    notification.offsetHeight; // Force reflow
    notification.classList.add('show');
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function loadWalletAmount() {
    const token = sessionStorage.getItem('token');
    if (!token) return;

    fetch('/get-wallet', {
        headers: {
            'Authorization': `Bearer ${token}`
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            currentWalletAmount = data.amount;
            const walletDisplay = document.getElementById('walletDisplayAmount');
            if (walletDisplay) {
                // Always start from 0, regardless of target amount
                countUpWallet(0, currentWalletAmount);
            }
        }
    })
    .catch(error => console.error('Error:', error));
}

function countUpWallet(startAmount, targetAmount) {
    const walletDisplay = document.getElementById('walletDisplayAmount');
    if (!walletDisplay) return;

    let current = startAmount;
    const duration = 1000; // 1 second duration
    const fps = 60; // frames per second
    const steps = duration / (1000 / fps); // number of steps in animation
    const increment = Math.abs(targetAmount - startAmount) / steps;
    const isIncreasing = targetAmount > startAmount;
    
    function step() {
        if (isIncreasing) {
            current = Math.min(current + increment, targetAmount);
        } else {
            current = Math.max(current - increment, targetAmount);
        }
        
        walletDisplay.textContent = Math.round(current).toLocaleString();
        
        if ((isIncreasing && current < targetAmount) || (!isIncreasing && current > targetAmount)) {
            requestAnimationFrame(step);
        } else {
            walletDisplay.textContent = targetAmount.toLocaleString(); // Ensure exact final value
        }
    }
    step();
}

// Update wallet display after deposit/withdraw
function updateWalletDisplay(newAmount) {
    const walletDisplay = document.getElementById('walletDisplayAmount');
    if (!walletDisplay) return;

    // Get the current amount from the display
    const currentAmount = parseInt(walletDisplay.textContent.replace(/,/g, '')) || 0;
    
    // Animate from current amount to new amount
    countUpWallet(currentAmount, newAmount);
}

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
    
    // Load wallet amount
    const token = sessionStorage.getItem('token');
    if (token) {
        fetch('/wallet-amount', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.amount !== undefined) {
                currentWalletAmount = data.amount;
                updateWalletDisplay(data.amount);
            }
        })
        .catch(error => {
            console.error('Error loading wallet:', error);
        });
    }
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

function updatePlayerCount(count) {
    const playerCountElement = document.getElementById('playerCount');
    if (!playerCountElement) return;

    // Directly update the text content
    playerCountElement.textContent = count.toLocaleString();
}

// Update the WebSocket message handler
socket.onmessage = function(event) {
    const data = JSON.parse(event.data);
    if (data.type === 'playerCount') {
        updatePlayerCount(data.count);
    }
};

