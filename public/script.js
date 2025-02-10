const socket = io();
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
    }, 200);  // Reduced from 500ms to 200ms

    if (findGameBtn.classList.contains('cancel')) {
        socket.emit('cancelSearch');
        findGameBtn.textContent = 'Find Game';
        findGameBtn.classList.remove('cancel');
        findGameBtn.disabled = true;
        status.textContent = 'Search cancelled';
        
        setTimeout(() => {
            findGameBtn.disabled = false;
        }, 300);  // Reduced from 1000ms to 300ms
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

socket.on('playerLeft', () => {
    gameState.gameActive = false;
    status.textContent = 'Opponent disconnected!';
    status.style.color = '#ff4444'; // Red color for disconnect message
    
    setTimeout(() => {
        status.style.color = 'var(--text)'; // Reset color after 3 seconds
        gameOverModal.style.display = 'none';
        findGameBtn.style.display = 'block';
        findGameBtn.disabled = false;
        findGameBtn.textContent = 'Find Game';
        findGameBtn.classList.remove('cancel');
        board.style.display = 'none';
        clearBoard();
        gameState = {
            roomId: null,
            symbol: null,
            isMyTurn: false,
            gameActive: false
        };
        status.textContent = 'Waiting for players...';
    }, 3000);
});

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

socket.on('updateUserCount', (count) => {
    livePlayerCount.textContent = `Live Players: ${count}`;
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
