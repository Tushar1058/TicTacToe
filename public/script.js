function generateSessionId() {
    const existingId = localStorage.getItem('guestSessionId');
    if (existingId) return existingId;
    
    const newId = Date.now() + Math.random().toString(36).substring(7);
    localStorage.setItem('guestSessionId', newId);
    return newId;
}

const sessionId = generateSessionId();
document.cookie = `sessionId=${sessionId};path=/;max-age=86400`; // 24 hours

// Generate a unique session ID for each tab
function generateTabId() {
    return Date.now() + Math.random().toString(36).substring(7);
}

const tabId = generateTabId();

const socket = io({
    auth: {
        username: localStorage.getItem('username') || 'Guest',
        token: localStorage.getItem('token'),
        tabId: tabId,
        isLoggedIn: !!localStorage.getItem('token')
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    transports: ['websocket', 'polling'],
    withCredentials: true,
    forceNew: true
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
    
    // Check if already in game first
    socket.emit('checkGameStatus', {
        username: localStorage.getItem('username'),
        isLoggedIn: !!localStorage.getItem('token')
    });

    if (findGameBtn.textContent === 'Find Game') {
        disableWalletControls(); // Disable wallet controls when finding game
    } else {
        enableWalletControls(); // Re-enable wallet controls when canceling
    }
    
    setTimeout(() => {
        isProcessingClick = false;
    }, 500);
});

socket.on('enterBettingLobby', ({ roomId }) => {
    console.log('Entering betting lobby:', roomId);
    gameState.roomId = roomId;
    
    // Hide game elements
    document.querySelector('.container h1').style.display = 'none';
    findGameBtn.style.display = 'none';
    board.style.display = 'none';
    
    // Show betting menu
    bettingMenu.style.display = 'flex';
    initBetSlider();
        
    setTimeout(() => {
        bettingMenu.classList.add('show');
        livePlayerCount.classList.add('shifted');
    }, 100);
    
    status.textContent = 'Waiting for both players to place bets...';
    
    // Show betting info UI
    const bettingInfo = document.getElementById('bettingInfo');
    bettingInfo.style.display = 'block';
    setTimeout(() => {
        bettingInfo.classList.add('show');
    }, 50);
    
    // Reset bet state when entering betting lobby
    betPlaced = false;
    placeBetButton.textContent = 'Place Bet';
});

socket.on('opponentBetPlaced', ({ message, opponentBetAmount }) => {
    status.textContent = 'Opponent placed their bet. Waiting for you...';
    // The betting info display is now handled by updateBettingInfo event
});

socket.on('bothBetsPlaced', () => {
    // Disable the Clear Bet and Leave buttons
    document.getElementById('placeBetButton').disabled = true;
    document.getElementById('leaveButton').disabled = true;

    // Decrease opacity to indicate disabled state
    document.getElementById('placeBetButton').style.opacity = 0.5;
    document.getElementById('leaveButton').style.opacity = 0.5;
});

socket.on('gameStart', ({ roomId, players, currentTurn, bets }) => {
    const isMobile = window.innerWidth <= 768;
    console.log('Game started:', { roomId, players, currentTurn, bets });
    
    gameState.roomId = roomId;
    gameState.symbol = players[socket.id];
    gameState.isMyTurn = currentTurn === socket.id;
    gameState.gameActive = true;
    
    // Only hide status text on mobile
    const statusText = document.getElementById('status');
    if (isMobile) {
        statusText.style.display = 'none';
        // Create new turn indicator
        let turnIndicator = document.createElement('div');
        turnIndicator.id = 'mobileTurnIndicator';
        document.querySelector('.game-board-section').prepend(turnIndicator);
    } else {
        statusText.style.display = 'block';
        updateStatus();
    }
    
    updateTurnStatus();
    
    // Show game board
    board.style.display = 'grid';
    clearBoard();
    updateStatus();
    // Create mobile turn indicator if it doesn't exist
    if (isMobile) {
        let turnIndicator = document.getElementById('mobileTurnIndicator');
        if (!turnIndicator) {
            turnIndicator = document.createElement('div');
            turnIndicator.id = 'mobileTurnIndicator';
            document.querySelector('.game-board-section').prepend(turnIndicator);
        }
        updateTurnStatus(); // This will set the correct text and classes
    }
    
    // Get player information
    const playerName = socket.handshake.auth.username || 'Player 1';
    const opponentId = Object.keys(players).find(id => id !== socket.id);
    const opponentName = players[opponentId].username || 'Player 2';
    
    // Update betting info display
    document.getElementById('playerName').textContent = playerName;
    document.getElementById('opponentName').textContent = opponentName;
    document.getElementById('yourBetAmount').textContent = `₹${bets[socket.id]}`;
    document.getElementById('opponentBetAmount').textContent = `₹${bets[opponentId]}`;
    const bettingInfo = document.getElementById('bettingInfo');
    bettingInfo.style.display = 'block';
    setTimeout(() => {
        bettingInfo.classList.add('show');
    }, 50);

    updateTurnStatus();
});

socket.on('gameUpdate', ({ board: gameBoard, currentTurn }) => {
    console.log('Game updated:', { gameBoard, currentTurn });
    
    gameState.isMyTurn = currentTurn === socket.id;
    updateBoard(gameBoard);
    updateStatus();
    updateTurnStatus();
});

socket.on('gameOver', ({ winner, board: finalBoard, currentTurn, newRound }) => {
    console.log('Game over:', { winner, newRound });
    
    if (winner === 'draw') {
        gameOverMessage.textContent = "It's a draw! Starting next round...";
        document.querySelector('.match-stats').style.display = 'flex';
        gameState.matchCount++;
        document.getElementById('matchCount').textContent = `Match: ${gameState.matchCount}`;
        gameOverModal.style.display = 'block';
        okButton.style.display = 'none';
        
        // Keep buttons disabled for new round
        document.getElementById('placeBetButton').disabled = true;
        document.getElementById('leaveButton').disabled = true;
        document.getElementById('placeBetButton').style.opacity = 0.5;
        document.getElementById('leaveButton').style.opacity = 0.5;
        
        setTimeout(() => {
            gameOverModal.style.display = 'none';
            // Reset game state for new round
            gameState.gameActive = true;
            gameState.isMyTurn = currentTurn === socket.id;
            clearBoard();
            updateBoard(finalBoard);
            
            // Remove old turn indicator and create new one
            removeMobileTurnIndicator();
            if (window.innerWidth <= 768) {
                let turnIndicator = document.createElement('div');
                turnIndicator.id = 'mobileTurnIndicator';
                document.querySelector('.game-board-section').prepend(turnIndicator);
                // Hide status text
                const statusText = document.getElementById('status');
                statusText.style.display = 'none';
            } else {
                updateStatus();
            }
            updateTurnStatus();
        }, 2000);
    } else {
        // Win/Loss case - enable buttons
        document.getElementById('placeBetButton').disabled = false;
        document.getElementById('leaveButton').disabled = false;
        document.getElementById('placeBetButton').style.opacity = 1;
        document.getElementById('leaveButton').style.opacity = 1;
        
        const isWinner = winner === gameState.symbol;
        gameOverMessage.textContent = isWinner ? 'Game Over - You Win!' : 'Game Over - You Lose!';
        gameOverModal.style.display = 'block';
        okButton.style.display = 'block';
        document.querySelector('.match-stats').style.display = 'none';
        
        // Only handle UI cleanup for the current player
        okButton.onclick = () => {
            gameOverModal.style.display = 'none';
            
            livePlayerCount.classList.remove('shifted');
            // Hide betting menu with animation
            if (bettingMenu.style.display !== 'none') {
                bettingMenu.classList.remove('show');
                
            }
            
            // Wait for betting menu animation to complete before hiding
            setTimeout(() => {
                bettingMenu.style.display = 'none';
                board.style.display = 'none';
                findGameBtn.style.display = 'block';
                findGameBtn.disabled = false;
                findGameBtn.textContent = 'Find Game';
                findGameBtn.classList.remove('cancel');
                status.textContent = 'Waiting for players...';
                document.querySelector('.container h1').style.display = 'block';
                resetGameState();
                resetBetSlider();
                resetAndHideBettingInfo();
                enableWalletControls();
                removeMobileTurnIndicator();
                // Reset opacity of buttons
            }, 500); // Match the CSS transition duration
        };
    }

    if (!newRound) {  // Only hide betting info if game is actually over
        const bettingInfo = document.getElementById('bettingInfo');
        bettingInfo.classList.remove('show');
        setTimeout(() => {
            bettingInfo.style.display = 'none';
        }, 500);
    }

    document.body.classList.remove('game-active');
    window.removeEventListener('resize', updateStatusPosition);
    removeMobileTurnIndicator();
});

// Update the server-side handler for game end
socket.on('opponentLeft', ({ message, isGameOver }) => {
    if (!isGameOver) {
        status.textContent = message;
        status.style.color = '#ff4444';
        
        // Animate betting menu out
        bettingMenu.classList.remove('show');
        livePlayerCount.classList.remove('shifted');
        
        // Wait for animation to complete
        setTimeout(() => {
            bettingMenu.style.display = 'none';
            status.style.color = 'var(--text)';
            status.textContent = 'Waiting for players...';
            document.querySelector('.container h1').style.display = 'block';
            gameOverModal.style.display = 'none';
            board.style.display = 'none';
            findGameBtn.style.display = 'block';
            findGameBtn.disabled = false;
            findGameBtn.textContent = 'Find Game';
            findGameBtn.classList.remove('cancel');
            clearBoard();
            resetGameState();
        }, 500); // Match the CSS transition duration
    }
});

// Update the playerLeft handler
socket.on('playerLeft', () => {
    gameState.gameActive = false;
    status.textContent = 'Opponent disconnected!';
    status.style.color = '#ff4444';
    livePlayerCount.classList.remove('shifted');
    // Hide betting menu with animation
    if (bettingMenu.style.display !== 'none') {
        bettingMenu.classList.remove('show');
      
    }
    
    setTimeout(() => {
        resetGameUI();
        bettingMenu.style.display = 'none';
        status.style.color = 'var(--text)';
        resetGameState();
        status.textContent = 'Waiting for players...';
        gameOverModal.style.display = 'none';
        board.style.display = 'none';
        document.querySelector('.match-stats').style.display = 'none';
        findGameBtn.style.display = 'block';
        findGameBtn.disabled = false;
        findGameBtn.textContent = 'Find Game';
        findGameBtn.classList.remove('cancel');
        clearBoard();
    }, 500);
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
    bettingMenu.classList.remove('show');
    livePlayerCount.classList.remove('shifted');
});

socket.on('newRound', ({ board, currentTurn }) => {
    clearBoard();
    gameState.gameActive = true;
    gameState.isMyTurn = currentTurn === socket.id;
    updateStatus();
    updateTurnStatus(); // Add turn status update for mobile indicator
    console.log('New round started, my turn:', gameState.isMyTurn);
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
    socket.emit('playerConnected', { sessionId: tabId });
    socket.emit('requestUserCount');
    const currentTime = Date.now();
    
    lastConnectTime = currentTime;
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    // Attempt to reconnect with polling if websocket fails
    if (socket.io.opts.transports.indexOf('polling') === -1) {
        socket.io.opts.transports = ['polling', 'websocket'];
    }
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    if (reason === 'io server disconnect') {
        // Reconnect if server disconnected
        socket.connect();
    }
});

socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected to server after ' + attemptNumber + ' attempts');
    if (localStorage.getItem('token')) {
        // Update socket authentication on reconnection
        updateSocketAuth();
    }
});

socket.on('reconnect_error', (error) => {
    console.log('Reconnection error:', error);
});

socket.on('updateUserCount', (count) => {
    updatePlayerCount(count);
});

let lastUpdateTime = 0;
const UPDATE_THRESHOLD = 300; // 300ms threshold

function updatePlayerCount(count) {
    const currentTime = Date.now();
    if (currentTime - lastUpdateTime < UPDATE_THRESHOLD) {
        return; // Skip update if too soon
    }
    
    const playerCountElement = document.getElementById('livePlayerCount');
    if (!playerCountElement) return;

    const numberElement = playerCountElement.querySelector('.number');
    const currentCount = parseInt(numberElement?.textContent || '0');

    // Only update if count is valid and has changed
    if (count >= 0 && count !== currentCount) {
        lastUpdateTime = currentTime;
        
        if (count > currentCount) {
            numberElement.classList.add('updating', 'up');
        } else {
            numberElement.classList.add('updating', 'down');
        }

        setTimeout(() => {
            numberElement.textContent = count.toLocaleString();
            setTimeout(() => {
                numberElement.classList.remove('updating', 'up', 'down');
            }, 300);
        }, 200);
    }
}

board.addEventListener('click', (e) => {
    if (!gameState.gameActive || !gameState.isMyTurn) return;
    
    const cell = e.target.closest('.cell');
    if (!cell) return;
    
    const symbolSpan = cell.querySelector('.symbol');
    if (cell && !symbolSpan.classList.contains('show')) {
        const index = parseInt(cell.dataset.index);
        
        // Send move to server with symbol
        socket.emit('makeMove', {
            roomId: gameState.roomId,
            index: index,
            symbol: gameState.symbol
        });
        
        // Don't update locally - wait for server response
        gameState.isMyTurn = false;
        updateStatus();
    }
});

function updateCell(cell, symbol) {
    const symbolSpan = cell.querySelector('.symbol');
    symbolSpan.setAttribute('data-symbol', symbol);
    symbolSpan.classList.add('show');
    symbolSpan.innerHTML = ''; // Clear any existing content
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

    // Update betting container state based on the current turn
    updateBettingContainerState(gameState.isMyTurn);
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
            const token = localStorage.getItem('token');
            const username = localStorage.getItem('username');
            
            if (!token || !username) {
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

            fetch('/update-wallet', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    username: username,
                    amount: amount 
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    updateWalletDisplay(data.balance);
                    document.getElementById('walletInputAmount').value = '';
                    showWalletNotification(`₹${amount} deposited successfully!`, 'success');
                } else {
                    throw new Error(data.error || 'Failed to update wallet');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showWalletNotification(error.message || 'Failed to update wallet');
            });
        });

        // Update withdraw handler
        document.getElementById("withdraw").addEventListener("click", function() {
            const token = localStorage.getItem('token');
            const username = localStorage.getItem('username');
            
            if (!token || !username) {
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

            fetch('/update-wallet', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    username: username,
                    amount: -amount // Negative for withdrawal
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    updateWalletDisplay(data.balance);
                    document.getElementById('walletInputAmount').value = '';
                    showWalletNotification(`₹${amount} withdrawn successfully!`, 'success');
                } else {
                    throw new Error(data.error || 'Failed to update wallet');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showWalletNotification(error.message || 'Failed to update wallet');
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
    notification.style.opacity = '1';
    setTimeout(() => {
        notification.style.opacity = '0';
    }, 3000);
}

function loadWalletAmount() {
    const token = localStorage.getItem('token');
    if (!token) return;

    fetch('/get-wallet', {
        headers: {
            'Authorization': `Bearer ${token}`        }
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
function updateWalletDisplay(amount) {
    const walletDisplay = document.getElementById('walletDisplayAmount');
    if (!walletDisplay) return;

    // Get the current amount from the display
    const currentAmount = parseInt(walletDisplay.textContent.replace(/,/g, '')) || 0;
    
    // Animate from current amount to new amount
    countUpWallet(currentAmount, amount);
}

document.addEventListener('DOMContentLoaded', function() {
    // Check if token exists
    const token = localStorage.getItem('token');
    if (token) {
        // Verify token with server
        fetch('/verify-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ token })
        })
        .then(response => response.json())
        .then(data => {
            if (data.valid) {
                showLoggedInState(data.username);
            } else {
                // Token is invalid, clear storage and show logged out state
                localStorage.removeItem('token');
                localStorage.removeItem('username');
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
        localStorage.removeItem('username');
        localStorage.removeItem('token');
        showLoggedOutState();
    });

    // Add event listeners for deposit and withdraw buttons
    const depositBtn = document.getElementById('depositBtn');
    const withdrawBtn = document.getElementById('withdrawBtn');

    if (depositBtn) {
        depositBtn.addEventListener('click', handleDeposit);
    }

    if (withdrawBtn) {
        withdrawBtn.addEventListener('click', handleWithdraw);
    }
});

function showLoggedInState(username) {
    document.getElementById('loginBtn').style.display = 'none';
    document.querySelector('.user-section').style.display = 'flex';
    document.querySelector('.username-display').textContent = username;
    
    // Show and enable wallet section
    const walletSection = document.querySelector('.wallet-section');
    if (walletSection) {
        walletSection.style.display = 'flex';
    }

    // Enable deposit and withdraw buttons
    const depositBtn = document.getElementById('depositBtn');
    const withdrawBtn = document.getElementById('withdrawBtn');
    
    if (depositBtn) {
        depositBtn.disabled = false;
    }
    
    if (withdrawBtn) {
        withdrawBtn.disabled = false;
    }

    updateSocketAuth();

    // Fetch initial wallet balance
    fetch('/verify-token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token: localStorage.getItem('token') })
    })
    .then(response => response.json())
    .then(data => {
        if (data.valid && data.wallet_amount !== undefined) {
            updateWalletDisplay(data.wallet_amount);
        }
    })
    .catch(error => console.error('Error fetching wallet balance:', error));
}

function showLoggedOutState() {
    document.getElementById('loginBtn').style.display = 'block';
    document.querySelector('.user-section').style.display = 'none';
    
    // Hide wallet section
    const walletSection = document.querySelector('.wallet-section');
    if (walletSection) {
        walletSection.style.display = 'none';
    }
    
    // Disable deposit and withdraw buttons
    const depositBtn = document.getElementById('depositBtn');
    const withdrawBtn = document.getElementById('withdrawBtn');
    
    if (depositBtn) {
        depositBtn.disabled = true;
    }
    
    if (withdrawBtn) {
        withdrawBtn.disabled = true;
    }
    
    // Reset wallet display to 0
    updateWalletDisplay(0);

    updateSocketAuth();
}

// Handle wallet updates
socket.on('wallet-update', (newBalance) => {
    console.log('Received wallet update:', newBalance);
    const walletDisplay = document.getElementById('walletDisplayAmount');
    if (walletDisplay) {
        walletDisplay.textContent = newBalance;
        
        // Add animation effect
        walletDisplay.style.transition = 'color 0.3s ease';
        walletDisplay.style.color = '#44ff44';
        setTimeout(() => {
            walletDisplay.style.color = 'white';
        }, 1000);
    }
});

// Function to handle deposit
function handleDeposit() {
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    
    if (!token || !username) {
        alert('Please log in to make a deposit');
        return;
    }

    const amount = parseFloat(prompt('Enter deposit amount:'));
    if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }

    fetch('/update-wallet', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            username: username,
            amount: amount
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            updateWalletDisplay(data.balance);
            alert(`Successfully deposited $${amount}`);
        } else {
            throw new Error(data.error || 'Failed to update wallet');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Failed to process deposit');
    });
}

// Function to handle withdrawal
function handleWithdraw() {
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    
    if (!token || !username) {
        alert('Please log in to make a withdrawal');
        return;
    }

    const amount = parseFloat(prompt('Enter withdrawal amount:'));
    if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }

    fetch('/update-wallet', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            username: username,
            amount: -amount // Negative amount for withdrawal
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            updateWalletDisplay(data.balance);
            alert(`Successfully withdrew $${amount}`);
        } else {
            throw new Error(data.error || 'Failed to update wallet');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Failed to process withdrawal');
    });
}

function updateSocketAuth() {
    const username = localStorage.getItem('username');
    const token = localStorage.getItem('token');
    if (socket.connected) {
        socket.auth = {
            username: username || 'Guest',
            token: token,
            tabId: tabId,
            isLoggedIn: !!token
        };
        socket.disconnect().connect();
    }
}

const bettingMenu = document.getElementById('bettingMenu');
const placeBetButton = document.getElementById('placeBetButton');
const leaveButton = document.getElementById('leaveButton');
const betAmountInput = document.getElementById('betAmount');

// Add slider initialization and handling
const betSlider = document.getElementById('betSlider');
const betNumbers = document.querySelector('.bet-numbers');
let currentBetAmount = 100;

// Initialize bet numbers
function initBetSlider() {
    betNumbers.innerHTML = ''; // Clear existing numbers
    const numbers = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
        200, 300, 400, 500, 600, 700, 800, 1000];
    numbers.forEach((num, index) => {
        const div = document.createElement('div');
        div.className = 'bet-number';
        div.textContent = num;
        div.dataset.index = index;
        div.addEventListener('click', () => updateSelectedBet(index));
        betNumbers.appendChild(div);
    });
    updateSelectedBet(0);
}

function updateSelectedBet(index) {
    const numbers = document.querySelectorAll('.bet-number');
    numbers.forEach(num => num.classList.remove('selected'));
    numbers[index].classList.add('selected');

    // Update currentBetAmount with the selected number's text content
    currentBetAmount = parseInt(numbers[index].textContent, 10);

    // Calculate the transform value to center the selected number
    const sliderWidth = betSlider.offsetWidth;
    const numberWidth = 80; // Fixed width of each number
    const centerOffset = (sliderWidth - numberWidth) / 2;
    const offset = -index * numberWidth + centerOffset;
    
    betNumbers.style.transform = `translateX(${offset}px)`;
}

function moveLeft() {
    const numbers = document.querySelectorAll('.bet-number');
    const currentIndex = Array.from(numbers).findIndex(num => num.classList.contains('selected'));
    if (currentIndex > 0) {
        updateSelectedBet(currentIndex - 1);
    }
}

function moveRight() {
    const numbers = document.querySelectorAll('.bet-number');
    const currentIndex = Array.from(numbers).findIndex(num => num.classList.contains('selected'));
    if (currentIndex < numbers.length - 1) {
        updateSelectedBet(currentIndex + 1);
    }
}

document.getElementById('leftArrow').addEventListener('click', moveLeft);
document.getElementById('rightArrow').addEventListener('click', moveRight);

// Add a variable to track if bet is placed
let betPlaced = false;

// Update the placeBet button handler
placeBetButton.addEventListener('click', () => {
    if (!betPlaced) {
        // Place bet logic
        if (currentBetAmount < 10 || currentBetAmount > 1000) {
            alert('Please select a bet amount between 10 and 1000');
            return;
        }
        socket.emit('placeBet', { roomId: gameState.roomId, betAmount: currentBetAmount });
        document.getElementById('yourBetAmount').textContent = `₹${currentBetAmount}`;
        document.getElementById('bettingInfo').style.display = 'block';
        
        placeBetButton.textContent = 'Clear Bet';
        betPlaced = true;
        updateBetSliderAppearance(true, currentBetAmount);
    } else {
        // Clear bet logic
        socket.emit('clearBet', { roomId: gameState.roomId });
        document.getElementById('yourBetAmount').textContent = '₹0';
        placeBetButton.textContent = 'Place Bet';
        betPlaced = false;
        updateBetSliderAppearance(false);

        // Clear any existing bet error messages
        const bettingInfo = document.getElementById('bettingInfo');
        const errorMessages = bettingInfo.querySelectorAll('.bet-error-message');
        errorMessages.forEach(msg => msg.remove());

        // Reset player statuses
        const playerStatus = document.querySelector('#playerBet .player-status');
        const opponentStatus = document.querySelector('#opponentBet .player-status');
        if (playerStatus) playerStatus.textContent = 'Placing bet...';
        if (opponentStatus) opponentStatus.textContent = 'Waiting...';
        playerStatus.style.color = 'rgba(0, 255, 136, 0.7)';
        opponentStatus.style.color = '#888';

        // Reset the status text
        const status = document.getElementById('status');
        status.textContent = 'Waiting for both players to place bets...';
    }
});

// Add socket event for opponent clearing bet
socket.on('opponentClearedBet', () => {
    document.getElementById('opponentBetAmount').textContent = '₹0';
    status.textContent = 'Waiting for both players to place bets...';
});

// Add new variables for leave confirmation
const leaveConfirm = document.getElementById('leaveConfirm');
const confirmYes = document.getElementById('confirmYes');
const confirmNo = document.getElementById('confirmNo');

// Update leave button click handler
leaveButton.addEventListener('click', () => {
    leaveConfirm.classList.add('show');
});

// Add confirmation button handlers
confirmYes.addEventListener('click', () => {
    socket.emit('betMenuLeave', { roomId: gameState.roomId });
    
    // Animate betting menu
    bettingMenu.classList.remove('show');
    livePlayerCount.classList.remove('shifted');
    leaveConfirm.classList.remove('show');
    
    setTimeout(() => {
        bettingMenu.style.display = 'none';
        resetGameUI();
        status.textContent = 'You left the lobby';
        status.style.color = '#ff4444';
        
        setTimeout(() => {
            status.style.color = 'var(--text)';
            status.textContent = 'Waiting for players...';
        }, 2000);
    }, 500);
});

confirmNo.addEventListener('click', () => {
    leaveConfirm.classList.remove('show');
});

// Add new handler for opponent leaving from bet menu
socket.on('opponentLeftLobby', ({ message, isFromBetMenu }) => {
    status.textContent = message;
    status.style.color = '#ff4444';
    
    // Animate betting menu out
    bettingMenu.classList.remove('show');
    livePlayerCount.classList.remove('shifted');
    
    setTimeout(() => {
        bettingMenu.style.display = 'none';
        resetGameUI();
        resetGameState();
        
        setTimeout(() => {
            status.style.color = 'var(--text)';
            status.textContent = 'Waiting for players...';
        }, 2000);
        enableWalletControls();
    }, 500);
});

// Add new handler for unexpected disconnection
socket.on('playerDisconnected', ({ message, temporary }) => {
    status.textContent = message;
    status.style.color = '#ff4444';
    livePlayerCount.classList.remove('shifted');
    // Handle betting menu animation
    if (bettingMenu.style.display !== 'none') {
        bettingMenu.classList.remove('show');
       
    }
    
    // Show disconnect message for 2 seconds, then exit room
    setTimeout(() => {
        bettingMenu.style.display = 'none';
        resetGameUI();
        resetGameState();
        status.style.color = 'var(--text)';
        status.textContent = 'Waiting for players...';
        gameOverModal.style.display = 'none';
        board.style.display = 'none';
        document.querySelector('.match-stats').style.display = 'none';
        findGameBtn.style.display = 'block';
        findGameBtn.disabled = false;
        findGameBtn.textContent = 'Find Game';
        findGameBtn.classList.remove('cancel');
        document.querySelector('.container h1').style.display = 'block';
        clearBoard();
        removeMobileTurnIndicator();
        // Reset opacity of buttons
    }, 3000);
});

// Add helper function for consistent UI reset
function resetGameUI() {
    board.style.display = 'none';
    findGameBtn.style.display = 'block';
    findGameBtn.disabled = false;
    findGameBtn.textContent = 'Find Game';
    findGameBtn.classList.remove('cancel');
    document.querySelector('.container h1').style.display = 'block';
    document.querySelector('.match-stats').style.display = 'none';
    clearBoard();
    resetGameState();
}

socket.on('opponentReadyToLeave', ({ message, roomId }) => {
    if (gameState.roomId === roomId) {
        status.textContent = message;
        // Don't automatically close the game for the other player
        // They need to click their own OK button to leave
    }
});

socket.on('useReadyToLeave', ({ roomId }) => {
    socket.emit('playerReadyToLeave', { roomId });
});

socket.on('bothPlayersLeft', ({ roomId }) => {
    if (gameState.roomId === roomId) {
        resetGameState();
        resetUI();
    }
});

// Helper functions to clean up the code
function resetGameState() {
    gameState = {
        roomId: null,
        symbol: null,
        isMyTurn: false,
        gameActive: false,
        matchCount: 1
    };
}

function resetUI() {
    gameOverModal.style.display = 'none';
    findGameBtn.style.display = 'block';
    findGameBtn.disabled = false;
    findGameBtn.textContent = 'Find Game';
    findGameBtn.classList.remove('cancel');
    board.style.display = 'none';
    status.textContent = 'Waiting for players...';
    clearBoard();
}

// Remove the alreadyInGame handler since we'll only use gameStatusResponse
socket.on('gameStatusResponse', ({ isInGame }) => {
    if (isInGame) {
        status.textContent = 'You are already in a game in another tab';
        status.style.color = '#ff4444';
        findGameBtn.textContent = 'Find Game';
        findGameBtn.classList.remove('cancel');
        findGameBtn.disabled = true;

        setTimeout(() => {
            status.style.color = 'var(--text)';
            status.textContent = 'Waiting for players...';
            findGameBtn.disabled = false;
        }, 2000);
    } else {
        if (findGameBtn.classList.contains('cancel')) {
            socket.emit('cancelSearch');
            findGameBtn.textContent = 'Find Game';
            findGameBtn.classList.remove('cancel');
            findGameBtn.disabled = true;
            status.textContent = 'Search cancelled';
            
            setTimeout(() => {
                findGameBtn.disabled = false;
            }, 1000);
        } else {
            findGameBtn.textContent = 'Cancel';
            findGameBtn.classList.add('cancel');
            status.textContent = 'Finding opponent...';
            socket.emit('findGame');
        }
    }
});

// Add new handler for self-play error
socket.on('selfPlayError', ({ message }) => {
    status.textContent = message;
    status.style.color = '#ff4444';
    findGameBtn.textContent = 'Find Game';
    findGameBtn.classList.remove('cancel');
    findGameBtn.disabled = true;

    setTimeout(() => {
        status.style.color = 'var(--text)';
        status.textContent = 'Waiting for players...';
        findGameBtn.disabled = false;
    }, 2000);
});


function handleMouseWheel(e) {
    e.preventDefault();
    
    // Add throttling to prevent rapid scrolling
    if (gameState.wheelTimeout) return;
    
    const numbers = document.querySelectorAll('.bet-number');
    const currentIndex = Array.from(numbers).findIndex(num => num.classList.contains('selected'));
    
    // Adjust threshold for medium sensitivity
    const threshold = 25; // Reduced from 50
    if (Math.abs(e.deltaY) < threshold) return;
    
    if (e.deltaY > 0 && currentIndex < numbers.length - 1) {
        // Scrolling down - move right
        updateSelectedBet(currentIndex + 1);
    } else if (e.deltaY < 0 && currentIndex > 0) {
        // Scrolling up - move left
        updateSelectedBet(currentIndex - 1);
    }
    
    // Adjust timeout for smoother scrolling
    gameState.wheelTimeout = setTimeout(() => {
        gameState.wheelTimeout = null;
    }, 200); // Reduced from 300ms for more responsive feel
}

// Add this after the existing event listeners
betSlider.addEventListener('wheel', handleMouseWheel, { passive: false });

socket.on('opponentDisconnected', ({ message, inGame, inBettingPhase, roomId }) => {
    console.log('Opponent disconnected:', { inGame, inBettingPhase });
    
    gameState.gameActive = false;
    status.textContent = message;
    status.style.color = '#ff4444';

    livePlayerCount.classList.remove('shifted');
    // Handle betting menu if it's visible
    if (bettingMenu.style.display !== 'none') {
        bettingMenu.classList.remove('show');
       
        
        setTimeout(() => {
            bettingMenu.style.display = 'none';
        }, 500);
    }
    removeMobileTurnIndicator();

    resetBetSlider();
    resetAndHideBettingInfo();
    // Handle different phases of disconnection
    const cleanup = () => {
        // Reset game elements
        board.style.display = 'none';
        gameOverModal.style.display = 'none';
        document.querySelector('.match-stats').style.display = 'none';
        
        // Show and reset find game button
        findGameBtn.style.display = 'block';
        findGameBtn.disabled = false;
        findGameBtn.textContent = 'Find Game';
        findGameBtn.classList.remove('cancel');
        
        // Show title
        document.querySelector('.container h1').style.display = 'block';
        
        // Reset game state
        resetGameState();
        clearBoard();
        
        // Reset status message after delay
        setTimeout(() => {
            status.style.color = 'var(--text)';
            status.textContent = 'Waiting for players...';
        }, 2000);
    };

    // Add appropriate delay based on game phase
    if (inGame) {
        setTimeout(cleanup, 1500);
    } else if (inBettingPhase) {
        setTimeout(cleanup, 500);
    } else {
        cleanup();
    }

    enableWalletControls();
    // Ensure we leave the room
    socket.emit('leaveRoom', { roomId });
    document.getElementById('placeBetButton').style.opacity = 1;
    document.getElementById('leaveButton').style.opacity = 1;
    
    // Enable the Clear Bet and Leave buttons
    document.getElementById('placeBetButton').disabled = false;
    document.getElementById('leaveButton').disabled = false;

    // Handle betting info animation
    const bettingInfo = document.getElementById('bettingInfo');
    if (bettingInfo.style.display !== 'none') {
        bettingInfo.classList.remove('show');
        setTimeout(() => {
            bettingInfo.style.display = 'none';
        }, 500);
    }

    
});

// Function to reset and hide betting info
function resetAndHideBettingInfo() {
    const bettingInfo = document.getElementById('bettingInfo');
    bettingInfo.classList.remove('show');
    setTimeout(() => {
        document.getElementById('yourBetAmount').textContent = '₹0';
        document.getElementById('opponentBetAmount').textContent = '₹0';
        document.getElementById('playerName').textContent = '';
        document.getElementById('opponentName').textContent = '';
        
        const playerStatus = document.querySelector('#playerBet .player-status');
        const opponentStatus = document.querySelector('#opponentBet .player-status');
        if (playerStatus) playerStatus.textContent = 'Placing bet...';
        if (opponentStatus) opponentStatus.textContent = 'Waiting...';
        
        bettingInfo.style.display = 'none';
    }, 500);
}


function updateBetSliderAppearance(isPlaced, amount = null) {
    const betNumbers = document.querySelectorAll('.bet-number');
    const leftArrow = document.getElementById('leftArrow');
    const rightArrow = document.getElementById('rightArrow');
    const betSelector = document.querySelector('.bet-selector');
    
    if (isPlaced) {
        // Immediately hide non-selected numbers
        betNumbers.forEach(num => {
            if (num.classList.contains('selected')) {
                // Create a formatted bet display
                num.innerHTML = `<div class="bet-display">
                    <span class="currency"> ₹ </span><span class="amount"> ${amount} </span>
                </div>`;
                num.style.visibility = 'visible';
            } else {
                num.style.transition = 'none';
                num.style.visibility = 'hidden';
            }
        });

        // Hide arrows and separator borders immediately
        leftArrow.style.transition = 'none';
        rightArrow.style.transition = 'none';
        betSelector.style.transition = 'none';
        
        leftArrow.style.display = 'none';
        rightArrow.style.display = 'none';
        betSelector.style.display = 'none';

        // Restore transitions after a brief delay
        setTimeout(() => {
            betNumbers.forEach(num => {
                num.style.transition = 'all 0.15s ease'; // Faster transition
            });
            leftArrow.style.transition = 'all 0.15s ease';
            rightArrow.style.transition = 'all 0.15s ease';
            betSelector.style.transition = 'all 0.15s ease';
        }, 50);
    } else {
        // Show all numbers and remove ₹ symbol
        betNumbers.forEach(num => {
            num.style.visibility = 'visible';
            num.textContent = num.textContent.replace('₹', '');
        });

        // Show arrows and separator borders
        leftArrow.style.display = 'flex';
        rightArrow.style.display = 'flex';
        betSelector.style.display = 'block';
    }
}

// Add this function to handle slider reset
function resetBetSlider() {
    updateBetSliderAppearance(false);
    const placeBetButton = document.getElementById('placeBetButton');
    if (placeBetButton) {
        placeBetButton.textContent = 'Place Bet';
    }
}

// Update the event listeners for opponent leaving/disconnecting
socket.on('opponentLeftLobby', ({ isFromBetMenu }) => {
    if (isFromBetMenu) {
        resetBetSlider();
        resetAndHideBettingInfo();
        enableWalletControls();
    }
});

socket.on('opponentDisconnected', ({ inBettingPhase }) => {
    if (inBettingPhase) {
        resetBetSlider();
        resetAndHideBettingInfo();
        enableWalletControls();
        removeMobileTurnIndicator();
    }
});

socket.on('leaveRoom', () => {
    resetBetSlider();
    resetAndHideBettingInfo();
    enableWalletControls();
});

// Handle bet errors
socket.on('betError', ({ message }) => {
    const bettingInfo = document.getElementById('bettingInfo');
    const errorMessage = document.createElement('div');
    errorMessage.className = 'bet-error-message';
    errorMessage.textContent = message;
    bettingInfo.appendChild(errorMessage);

    // Update player statuses to indicate mismatch
    const playerStatus = document.querySelector('#playerBet .player-status');
    const opponentStatus = document.querySelector('#opponentBet .player-status');
    playerStatus.textContent = 'Bet mismatch';
    opponentStatus.textContent = 'Bet mismatch';
    playerStatus.style.color = '#ff4444';
    opponentStatus.style.color = '#ff4444';

    // Update the status text
    const status = document.getElementById('status');
    status.textContent = 'Please match the bet to start game';

    setTimeout(() => {
        errorMessage.remove();
    }, 5000);
});

// Add this event handler to update betting info display
socket.on('updateBettingInfo', ({ players }) => {
    const bettingInfo = document.getElementById('bettingInfo');
    const bettingMenu = document.getElementById('bettingMenu');
    const isMobile = window.innerWidth <= 768;
    
    if (bettingInfo.style.display !== 'block') {
        bettingInfo.style.display = 'block';
        setTimeout(() => {
            bettingInfo.classList.add('show');
        }, 50);
    }
    
    let bothBetsPlaced = true;
    let betMismatch = false;

    // Check for bet mismatch
    if (players.length === 2) {
        const bets = players.map(p => p.betAmount);
        betMismatch = bets[0] !== bets[1] && bets[0] !== 0 && bets[1] !== 0;
    }

    players.forEach(player => {
        if (player.id === socket.id) {
            document.getElementById('playerName').textContent = player.username;
            document.getElementById('yourBetAmount').textContent = player.betPlaced ? `₹${player.betAmount}` : '₹0';
            const playerStatus = document.querySelector('#playerBet .player-status');
            playerStatus.textContent = player.betPlaced ? 'Bet placed' : 'Placing bet...';
            playerStatus.style.color = player.betPlaced ? 'var(--primary)' : 'rgba(0, 255, 136, 0.7)';
        } else {
            document.getElementById('opponentName').textContent = player.username;
            document.getElementById('opponentBetAmount').textContent = player.betPlaced ? `₹${player.betAmount}` : '₹0';
            const opponentStatus = document.querySelector('#opponentBet .player-status');
            opponentStatus.textContent = player.betPlaced ? 'Bet placed' : 'Waiting...';
            opponentStatus.style.color = player.betPlaced ? 'var(--primary)' : '#888';
        }

        if (!player.betPlaced) {
            bothBetsPlaced = false;
        }
    });

    // Only animate out betting menu if both bets are placed, match, and we're on mobile
    if (bothBetsPlaced && !betMismatch && isMobile) {
        bettingMenu.classList.remove('show');
        bettingMenu.classList.add('hide');
        setTimeout(() => {
            bettingMenu.style.display = 'none';
            bettingMenu.classList.remove('hide');
        }, 300);
    } else if (isMobile && (betMismatch || !bothBetsPlaced)) {
        // Show betting menu if there's a mismatch or bets aren't placed
        bettingMenu.style.display = 'flex';
        bettingMenu.classList.remove('hide');
        bettingMenu.classList.add('show');
    }

    // Update the betting container state based on the current turn
    if (bothBetsPlaced) {
        updateBettingContainerState(gameState.isMyTurn);
    } else {
        // Reset the opponent's container to inactive if both bets are not placed
        const opponentContainer = document.querySelector('#opponentBet').parentElement;
        opponentContainer.classList.remove('active');
        opponentContainer.classList.add('inactive');
    }
});

function disableWalletControls() {
    const depositBtn = document.getElementById('depositBtn');
    const withdrawBtn = document.getElementById('withdrawBtn');
    const walletSection = document.querySelector('.wallet-section');
    
    if (depositBtn) {
        depositBtn.disabled = true;
        depositBtn.style.pointerEvents = 'none'; // Prevent clicking
    }
    if (withdrawBtn) {
        withdrawBtn.disabled = true;
        withdrawBtn.style.pointerEvents = 'none'; // Prevent clicking
    }
    if (walletSection) {
        walletSection.style.opacity = '0.5';
        walletSection.style.pointerEvents = 'none'; // Prevent clicking
    }
}

// Add this function to enable wallet controls
function enableWalletControls() {
    const depositBtn = document.getElementById('depositBtn');
    const withdrawBtn = document.getElementById('withdrawBtn');
    const walletSection = document.querySelector('.wallet-section');
    
    if (depositBtn) {
        depositBtn.disabled = false;
        depositBtn.style.pointerEvents = 'auto'; // Re-enable clicking
    }
    if (withdrawBtn) {
        withdrawBtn.disabled = false;
        withdrawBtn.style.pointerEvents = 'auto'; // Re-enable clicking
    }
    if (walletSection) {
        walletSection.style.opacity = '1';
        walletSection.style.pointerEvents = 'auto'; // Re-enable clicking
    }
}

// Add this function to update betting info container animations
function updateBettingContainerState(isMyTurn) {
    const playerContainer = document.querySelector('#playerBet').parentElement;
    const opponentContainer = document.querySelector('#opponentBet').parentElement;
    
    if (isMyTurn) {
        playerContainer.classList.add('active');
        playerContainer.classList.remove('inactive');
        opponentContainer.classList.add('inactive');
        opponentContainer.classList.remove('active');
    } else {
        opponentContainer.classList.add('active');
        opponentContainer.classList.remove('inactive');
        playerContainer.classList.add('inactive');
        playerContainer.classList.remove('active');
    }
}

// Update the turn change handler
socket.on('turnChange', ({ currentTurn }) => {
    gameState.isMyTurn = currentTurn === socket.id;
    updateBettingContainerState(gameState.isMyTurn);
    updateStatus();
    updateTurnStatus();
});

document.addEventListener('DOMContentLoaded', function() {
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const icon = fullscreenBtn.querySelector('i');

    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.log(`Error attempting to enable fullscreen: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    });

    // Update icon when fullscreen changes
    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            icon.classList.remove('fa-expand');
            icon.classList.add('fa-compress');
            fullscreenBtn.classList.add('active');
        } else {
            icon.classList.remove('fa-compress');
            icon.classList.add('fa-expand');
            fullscreenBtn.classList.remove('active');
        }
    });
});

socket.on('betMenuLeave', ({ roomId }) => {
    // ... existing code ...
    
    const bettingInfo = document.getElementById('bettingInfo');
    bettingInfo.classList.remove('show');
    setTimeout(() => {
        bettingInfo.style.display = 'none';
    }, 500);
    
    // ... rest of the code ...
});

socket.on('updateBoard', ({ index, symbol }) => {
    handleMove(index, symbol);
    updateTurnStatus();
});



function updateTurnStatus() {
    const isMobile = window.innerWidth <= 768;
    const turnIndicator = document.getElementById('mobileTurnIndicator');
    
    if (!isMobile) {
        // Update PC status text
        const status = document.getElementById('status');
        status.style.display = 'block';
        status.textContent = gameState.isMyTurn ? `Your turn (${gameState.symbol})` : `Opponent's turn (${gameState.symbol === 'X' ? 'O' : 'X'})`;
        return;
    }

    if (turnIndicator) {
        turnIndicator.textContent = gameState.isMyTurn ? `Your Turn (${gameState.symbol})` : `Opponent's Turn (${gameState.symbol === 'X' ? 'O' : 'X'})`;
        turnIndicator.className = `mobile-turn-indicator ${gameState.isMyTurn ? 'your-turn' : 'opponent-turn'}`;
    }
}

// Update the game start handler
socket.on('gameStart', () => {
    document.body.classList.add('game-active');
    updateTurnStatus();
    window.addEventListener('resize', updateTurnStatus);
});

// Clean up when game ends
socket.on('gameEnd', () => {
    document.body.classList.remove('game-active');
    removeMobileTurnIndicator();
    window.removeEventListener('resize', updateTurnStatus);
});

// Add CSS for the mobile turn indicator
const style = document.createElement('style');
style.textContent = `
.mobile-turn-indicator {
    position: absolute;
    top: 300px;
    height: 55px;
    background: rgba(34, 34, 34, 0);
    border: 1px solid var(--primary);
    border-radius: 4px;
    padding: 15px 20px;
    color: white;
    text-align: center;
    margin-top: 20px;
    font-size: 1em;
    transition: all 0.3s ease;
    width: 85%;
    margin-left: auto;
    margin-right: auto;
}

.mobile-turn-indicator.your-turn {
     border-color:rgb(161, 161, 161);
    color: rgb(255, 255, 255);
    font-weight: 600;
}

.mobile-turn-indicator.opponent-turn {
    border-color:rgb(161, 161, 161);
    color: rgb(161, 161, 161);
}
`;
document.head.appendChild(style);

// Function to remove mobile turn indicator
function removeMobileTurnIndicator() {
    const turnIndicator = document.getElementById('mobileTurnIndicator');
    if (turnIndicator) {
        turnIndicator.remove();
    }
    
    // Show status text again on mobile
    if (window.innerWidth <= 768) {
        showStatusText();
    }
}

function showStatusText() {
    const statusText = document.getElementById('status');
    if (statusText) {
        statusText.style.display = 'block';
    }
}

// Add network status detection
window.addEventListener('online', function() {
    console.log('Network connection restored');
    if (!socket.connected) {
        socket.connect();
    }
});

window.addEventListener('offline', function() {
    console.log('Network connection lost');
});

// Add reconnection handling
socket.io.on("reconnect_attempt", () => {
    console.log('Attempting to reconnect...');
});

socket.io.on("reconnect", (attempt) => {
    console.log('Reconnected after ' + attempt + ' attempts');
});

socket.io.on("reconnect_error", (error) => {
    console.log('Reconnection error:', error);
});

