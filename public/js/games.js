(() => {
    const gameNames = {
        flappy: 'Flappy Bird',
        pong: 'Pong',
        rps: 'Rock Paper Scissors',
        snake: 'Snake',
        shooter: 'Space Shooter',
        tictactoe: 'Tic Tac Toe'
    };
    const rpsOptions = [
        { value: 'rock', label: 'Rock', icon: 'landscape' },
        { value: 'paper', label: 'Paper', icon: 'description' },
        { value: 'scissors', label: 'Scissors', icon: 'content_cut' }
    ];
    const elements = {
        name: document.getElementById('player-name'),
        selectedGame: document.getElementById('selected-game'),
        create: document.getElementById('create-room'),
        roomCode: document.getElementById('room-code-input'),
        join: document.getElementById('join-room'),
        message: document.getElementById('room-message'),
        playersPanel: document.getElementById('players-panel'),
        roomCodeLabel: document.getElementById('room-code-label'),
        players: document.getElementById('player-slots'),
        boardPanel: document.getElementById('game-board-panel'),
        boardTitle: document.getElementById('active-game-title'),
        status: document.getElementById('match-status'),
        surface: document.getElementById('game-surface'),
        online: document.getElementById('online-count'),
        connection: document.querySelector('.connection'),
        connectionLabel: document.getElementById('connection-label')
    };
    const socket = io();
    let selectedGame = null;
    let currentRoom = null;
    let renderedGame = null;
    let localGame = null;
    let animationId = 0;
    let lastPongInput = 0;
    let pongDirection = 0;
    const pressedKeys = new Set();

    function setMessage(message, kind = '') {
        elements.message.textContent = message;
        elements.message.className = `room-message${kind ? ` ${kind}` : ''}`;
    }

    function send(event, payload = {}) {
        return new Promise((resolve) => socket.emit(event, payload, resolve));
    }

    function playerName() {
        const name = elements.name.value.trim().slice(0, 20);
        if (!name) {
            elements.name.focus();
            setMessage('Enter your name to continue.', 'error');
            return '';
        }
        return name;
    }

    function chooseGame(game) {
        if (currentRoom) return;
        selectedGame = game;
        document.querySelectorAll('.game-tile').forEach((tile) => tile.classList.toggle('selected', tile.dataset.tile === game));
        elements.selectedGame.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">sports_esports</span><span>${gameNames[game]} selected</span>`;
        elements.create.disabled = false;
        setMessage(`Ready to open a ${gameNames[game]} room.`);
    }

    document.querySelectorAll('[data-select-game]').forEach((button) => {
        button.addEventListener('click', () => chooseGame(button.dataset.selectGame));
    });

    elements.create.addEventListener('click', async () => {
        const name = playerName();
        if (!name || !selectedGame) return;
        elements.create.disabled = true;
        const result = await send('game:create', { game: selectedGame, name });
        if (result.error) {
            elements.create.disabled = false;
            setMessage(result.error, 'error');
        } else {
            setMessage('Room created. Share the code with a friend.', 'success');
        }
    });

    elements.join.addEventListener('click', async () => {
        const name = playerName();
        if (!name) return;
        const code = elements.roomCode.value.trim().toUpperCase();
        if (!/^[A-F0-9]{6}$/.test(code)) {
            setMessage('Enter the six-character room code.', 'error');
            elements.roomCode.focus();
            return;
        }
        elements.join.disabled = true;
        const result = await send('game:join', { code, name });
        elements.join.disabled = false;
        if (result.error) setMessage(result.error, 'error');
        else setMessage(`Joined ${gameNames[result.room.game]}. Good luck.`, 'success');
    });

    elements.roomCode.addEventListener('input', () => {
        elements.roomCode.value = elements.roomCode.value.replace(/[^a-f0-9]/gi, '').slice(0, 6).toUpperCase();
    });

    document.getElementById('copy-room').addEventListener('click', async () => {
        if (!currentRoom) return;
        try {
            await navigator.clipboard.writeText(currentRoom.code);
            setMessage(`Room code ${currentRoom.code} copied.`, 'success');
        } catch {
            elements.roomCode.value = currentRoom.code;
            elements.roomCode.select();
            setMessage('Room code selected. Copy it to invite a friend.', 'success');
        }
    });

    document.getElementById('leave-room').addEventListener('click', async () => {
        await send('game:leave');
        clearRoom();
        setMessage('You left the room. Choose a game to play again.');
    });

    document.getElementById('restart-game').addEventListener('click', async () => {
        if (!currentRoom) return;
        const result = await send('game:restart');
        if (result.error) setMessage(result.error, 'error');
        else resetLocalGame();
    });

    function clearLocalGame() {
        if (animationId) cancelAnimationFrame(animationId);
        animationId = 0;
        localGame = null;
        renderedGame = null;
        pressedKeys.clear();
    }

    function clearRoom() {
        clearLocalGame();
        currentRoom = null;
        elements.playersPanel.hidden = true;
        elements.boardPanel.hidden = true;
        elements.surface.replaceChildren();
        elements.create.disabled = !selectedGame;
        elements.join.disabled = false;
        elements.name.disabled = false;
        document.querySelectorAll('.game-tile').forEach((tile) => { tile.disabled = false; });
    }

    function renderPlayers(room) {
        elements.players.replaceChildren();
        for (let index = 0; index < 2; index += 1) {
            const player = room.players[index];
            const slot = document.createElement('div');
            slot.className = `player-slot${player ? '' : ' empty'}`;
            const dot = document.createElement('span');
            dot.className = 'slot-dot';
            const label = document.createElement('span');
            label.textContent = player ? `${player.name}${index === 0 ? ' · HOST' : ''}` : 'Waiting for player...';
            slot.append(dot, label);
            elements.players.append(slot);
        }
    }

    function renderRoom(room) {
        const previousRoom = currentRoom;
        const resetArcade = previousRoom?.code === room.code && previousRoom.revision !== room.revision;
        const matchStarted = !previousRoom?.started && room.started;
        const playersChanged = !previousRoom || previousRoom.code !== room.code || previousRoom.players.map((player) => player.id).join() !== room.players.map((player) => player.id).join();
        if (previousRoom && previousRoom.code !== room.code) clearLocalGame();
        currentRoom = room;
        elements.playersPanel.hidden = false;
        elements.roomCodeLabel.textContent = room.code;
        if (playersChanged) renderPlayers(room);
        elements.create.disabled = true;
        elements.join.disabled = true;
        elements.name.disabled = true;
        document.querySelectorAll('.game-tile').forEach((tile) => { tile.disabled = true; });
        elements.boardPanel.hidden = false;
        elements.boardTitle.textContent = gameNames[room.game];

        if (!room.started) {
            elements.status.textContent = 'Share the invite code; the room seats one more player.';
            if (renderedGame !== room.game) renderGameSurface(room.game);
            return;
        }

        if (renderedGame !== room.game) renderGameSurface(room.game);
        if ((resetArcade || matchStarted) && ['flappy', 'snake', 'shooter'].includes(room.game)) resetLocalGameState();
        renderGameState(room);
    }

    function renderGameSurface(game) {
        clearLocalGame();
        renderedGame = game;
        elements.surface.replaceChildren();
        if (game === 'tictactoe') {
            const board = document.createElement('div');
            board.className = 'ttt-board';
            board.setAttribute('role', 'group');
            board.setAttribute('aria-label', 'Tic Tac Toe board');
            for (let index = 0; index < 9; index += 1) {
                const cell = document.createElement('button');
                cell.type = 'button';
                cell.className = 'ttt-cell';
                cell.dataset.index = String(index);
                cell.setAttribute('aria-label', `Square ${index + 1}`);
                cell.addEventListener('click', async () => {
                    const result = await send('game:ttt-move', { index });
                    if (result.error) elements.status.textContent = result.error;
                });
                board.append(cell);
            }
            elements.surface.append(board);
        } else if (game === 'rps') {
            const choices = document.createElement('div');
            choices.className = 'rps-choices';
            for (const option of rpsOptions) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'rps-choice';
                button.dataset.choice = option.value;
                button.title = option.label;
                button.setAttribute('aria-label', option.label);
                button.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${option.icon}</span>`;
                button.addEventListener('click', async () => {
                    const result = await send('game:rps-choice', { choice: option.value });
                    if (result.error) elements.status.textContent = result.error;
                });
                choices.append(button);
            }
            elements.surface.append(choices);
        } else {
            const canvas = document.createElement('canvas');
            canvas.className = `game-canvas${game === 'snake' ? ' tall' : ''}`;
            canvas.setAttribute('aria-label', `${gameNames[game]} game`);
            elements.surface.append(canvas);
            if (game === 'pong') {
                const controls = document.createElement('div');
                controls.className = 'arcade-controls';
                controls.innerHTML = '<button type="button" data-pong="-1" aria-label="Move paddle up">▲</button><button type="button" data-pong="1" aria-label="Move paddle down">▼</button>';
                elements.surface.append(controls);
                controls.querySelectorAll('[data-pong]').forEach((button) => {
                    const direction = Number(button.dataset.pong);
                    button.addEventListener('pointerdown', () => { pongDirection = direction; });
                    button.addEventListener('pointerup', () => { pongDirection = 0; });
                    button.addEventListener('pointerleave', () => { pongDirection = 0; });
                });
                canvas.addEventListener('pointermove', (event) => {
                    const bounds = canvas.getBoundingClientRect();
                    const y = Math.max(.1, Math.min(.9, (event.clientY - bounds.top) / bounds.height));
                    send('game:pong-paddle', { y });
                    lastPongInput = performance.now();
                });
            } else {
                setupArcade(game);
            }
        }
    }

    function updateStatus(room) {
        const state = room.state;
        const playerIndex = socket.id === room.players[1]?.id ? 1 : 0;
        if (!room.started) {
            elements.status.textContent = 'Waiting for another player...';
        } else if (room.game === 'tictactoe') {
            if (state.winner) elements.status.textContent = state.winner === (playerIndex === 0 ? 'X' : 'O') ? 'You won this round.' : `${room.players[state.winner === 'X' ? 0 : 1].name} wins this round.`;
            else if (state.draw) elements.status.textContent = 'A draw. Play again?';
            else elements.status.textContent = state.turn === playerIndex ? 'Your turn.' : `${room.players[state.turn]?.name || 'Opponent'} is choosing.`;
            elements.surface.querySelectorAll('.ttt-cell').forEach((cell) => {
                const index = Number(cell.dataset.index);
                cell.textContent = state.board[index] || '';
                cell.disabled = !room.started || Boolean(state.winner || state.draw || state.board[index]) || state.turn !== playerIndex;
            });
        } else if (room.game === 'rps') {
            if (state.winner !== null) elements.status.textContent = state.winner === playerIndex ? 'You won the match!' : `${room.players[state.winner]?.name || 'Your friend'} won the match.`;
            else if (state.result) elements.status.textContent = `${state.result} · ${state.wins[0]}–${state.wins[1]}`;
            else if (state.picked?.[playerIndex]) elements.status.textContent = 'Locked in. Waiting for your friend...';
            else if (state.picked?.[1 - playerIndex]) elements.status.textContent = 'Your friend is ready. Make your pick.';
            else elements.status.textContent = `Round ${state.round} · First to 3`;
            elements.surface.querySelectorAll('.rps-choice').forEach((button) => {
                button.disabled = Boolean(state.winner !== null || state.picked?.[playerIndex]);
            });
        } else if (room.game === 'pong') {
            elements.status.textContent = state.winner !== null
                ? `${room.players[state.winner]?.name || 'Player'} wins · ${state.scores[0]}–${state.scores[1]}`
                : `${room.players[0].name} ${state.scores[0]} — ${state.scores[1]} ${room.players[1].name} · First to 5`;
            drawPong(state);
        } else {
            if (state.winner === -1) elements.status.textContent = `Draw · ${room.players[0].name}: ${state.scores[0]}  ·  ${room.players[1].name}: ${state.scores[1]}`;
            else if (state.winner !== null) elements.status.textContent = `${room.players[state.winner].name} wins · ${state.scores[0]}–${state.scores[1]}`;
            else if (state.finished[playerIndex]) elements.status.textContent = `Run complete · ${room.players[0].name}: ${state.scores[0]}  ·  ${room.players[1].name}: ${state.scores[1]} · Waiting for your friend`;
            else elements.status.textContent = `${room.players[0].name}: ${state.scores[0]}  ·  ${room.players[1].name}: ${state.scores[1]} · Best score wins`;
            drawArcadeFrame();
        }
    }

    function renderGameState(room) {
        updateStatus(room);
    }

    function configureCanvas(canvas, width, height) {
        const scale = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const pixelWidth = Math.max(1, Math.round(rect.width * scale));
        const pixelHeight = Math.max(1, Math.round(rect.height * scale));
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
        }
        const context = canvas.getContext('2d');
        context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
        return context;
    }

    function drawPong(state) {
        const canvas = elements.surface.querySelector('canvas');
        if (!canvas) return;
        const context = configureCanvas(canvas, 600, 400);
        context.fillStyle = '#18221f';
        context.fillRect(0, 0, 600, 400);
        context.setLineDash([7, 9]);
        context.strokeStyle = 'rgba(255,255,255,.25)';
        context.beginPath();
        context.moveTo(300, 10);
        context.lineTo(300, 390);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = '#d1dfae';
        context.fillRect(25, state.paddles[0] * 400 - 45, 10, 90);
        context.fillRect(565, state.paddles[1] * 400 - 45, 10, 90);
        context.beginPath();
        context.arc(state.ball.x * 600, state.ball.y * 400, 8, 0, Math.PI * 2);
        context.fillStyle = '#e8ca7c';
        context.fill();
        if (state.winner !== null) {
            context.fillStyle = 'rgba(0,0,0,.45)';
            context.fillRect(0, 0, 600, 400);
            context.fillStyle = '#fff';
            context.font = '600 25px Arial';
            context.textAlign = 'center';
            context.fillText(`${currentRoom.players[state.winner].name} wins`, 300, 205);
        }
    }

    function setupArcade(game) {
        const canvas = elements.surface.querySelector('canvas');
        const controls = document.createElement('div');
        controls.className = 'arcade-controls';
        if (game === 'flappy') {
            controls.innerHTML = '<button type="button" data-flap aria-label="Flap">FLAP</button>';
            canvas.addEventListener('pointerdown', flap);
            controls.querySelector('[data-flap]').addEventListener('pointerdown', flap);
        } else if (game === 'snake') {
            controls.innerHTML = '<button type="button" data-dir="up" aria-label="Up">▲</button><button type="button" data-dir="left" aria-label="Left">◀</button><button type="button" data-dir="down" aria-label="Down">▼</button><button type="button" data-dir="right" aria-label="Right">▶</button>';
            controls.querySelectorAll('[data-dir]').forEach((button) => button.addEventListener('click', () => setSnakeDirection(button.dataset.dir)));
        } else {
            controls.innerHTML = '<button type="button" data-move="-1" aria-label="Move left">◀</button><button type="button" data-fire aria-label="Fire">FIRE</button><button type="button" data-move="1" aria-label="Move right">▶</button>';
            controls.querySelectorAll('[data-move]').forEach((button) => {
                const direction = Number(button.dataset.move);
                button.addEventListener('pointerdown', () => pressedKeys.add(direction < 0 ? 'ArrowLeft' : 'ArrowRight'));
                button.addEventListener('pointerup', () => pressedKeys.delete(direction < 0 ? 'ArrowLeft' : 'ArrowRight'));
                button.addEventListener('pointerleave', () => pressedKeys.delete(direction < 0 ? 'ArrowLeft' : 'ArrowRight'));
            });
            controls.querySelector('[data-fire]').addEventListener('pointerdown', () => {
                if (localGame?.over) resetLocalGameState();
                pressedKeys.add(' ');
            });
            controls.querySelector('[data-fire]').addEventListener('pointerup', () => pressedKeys.delete(' '));
        }
        elements.surface.append(controls);
        resetLocalGame();
    }

    function flap(event) {
        event.preventDefault();
        if (!localGame || localGame.game !== 'flappy') return;
        if (localGame.over) resetLocalGame();
        localGame.velocity = -0.29;
    }

    function setSnakeDirection(direction) {
        if (localGame?.game === 'snake' && localGame.over) resetLocalGameState();
        if (!localGame || localGame.game !== 'snake' || localGame.over) return;
        const opposites = { up: 'down', down: 'up', left: 'right', right: 'left' };
        if (opposites[direction] !== localGame.direction) localGame.nextDirection = direction;
    }

    function stepArcade(timestamp) {
        if (!localGame || !currentRoom?.started) return;
        const elapsed = Math.min(50, Math.max(0, timestamp - localGame.lastTime));
        localGame.lastTime = timestamp;
        if (localGame.game === 'flappy') updateFlappy(elapsed, timestamp);
        else if (localGame.game === 'snake') updateSnake(elapsed);
        else updateShooter(elapsed, timestamp);
        drawArcadeFrame();
        animationId = requestAnimationFrame(stepArcade);
    }

    function setScore(score) {
        if (!localGame || score <= localGame.score) return;
        localGame.score = score;
        socket.emit('game:arcade-score', { score });
    }

    function updateFlappy(elapsed, timestamp) {
        if (localGame.over) return;
        localGame.velocity = Math.min(.42, localGame.velocity + elapsed * .00056);
        localGame.y += localGame.velocity * elapsed;
        for (const pipe of localGame.pipes) pipe.x -= elapsed * .15;
        if (timestamp - localGame.lastPipe > 1950) {
            localGame.pipes.push({ x: 450, gap: 95 + Math.random() * 105 });
            localGame.lastPipe = timestamp;
        }
        localGame.pipes = localGame.pipes.filter((pipe) => pipe.x > -45);
        for (const pipe of localGame.pipes) {
            if (pipe.x < 94 && pipe.x + 42 > 58 && (localGame.y < pipe.gap - 48 || localGame.y > pipe.gap + 48)) finishArcadeRun();
            if (!pipe.passed && pipe.x + 42 < 58) {
                pipe.passed = true;
                setScore(localGame.score + 1);
            }
        }
        if (localGame.y < 9 || localGame.y > 270) finishArcadeRun();
    }

    function updateSnake(elapsed) {
        if (localGame.over) return;
        localGame.accumulator += elapsed;
        while (localGame.accumulator >= 145) {
            localGame.accumulator -= 145;
            localGame.direction = localGame.nextDirection;
            const head = { ...localGame.body[0] };
            if (localGame.direction === 'up') head.y -= 1;
            if (localGame.direction === 'down') head.y += 1;
            if (localGame.direction === 'left') head.x -= 1;
            if (localGame.direction === 'right') head.x += 1;
            if (head.x < 0 || head.x >= 21 || head.y < 0 || head.y >= 15 || localGame.body.some((part) => part.x === head.x && part.y === head.y)) {
                finishArcadeRun();
                return;
            }
            localGame.body.unshift(head);
            if (head.x === localGame.food.x && head.y === localGame.food.y) {
                setScore(localGame.score + 10);
                do { localGame.food = { x: Math.floor(Math.random() * 21), y: Math.floor(Math.random() * 15) }; }
                while (localGame.body.some((part) => part.x === localGame.food.x && part.y === localGame.food.y));
            } else localGame.body.pop();
        }
    }

    function updateShooter(elapsed, timestamp) {
        if (localGame.over) return;
        if (pressedKeys.has('ArrowLeft') || pressedKeys.has('a')) localGame.ship = Math.max(17, localGame.ship - elapsed * .22);
        if (pressedKeys.has('ArrowRight') || pressedKeys.has('d')) localGame.ship = Math.min(403, localGame.ship + elapsed * .22);
        if (pressedKeys.has(' ') && timestamp - localGame.lastShot > 240) {
            localGame.bullets.push({ x: localGame.ship, y: 245 });
            localGame.lastShot = timestamp;
        }
        if (timestamp > localGame.nextWave) {
            for (let index = 0; index < 5; index += 1) localGame.enemies.push({ x: 35 + index * 85, y: -15 - Math.random() * 45, speed: .04 + Math.random() * .035 });
            localGame.nextWave = timestamp + 2500;
        }
        localGame.bullets.forEach((bullet) => { bullet.y -= elapsed * .34; });
        localGame.enemies.forEach((enemy) => { enemy.y += elapsed * enemy.speed; });
        localGame.bullets = localGame.bullets.filter((bullet) => bullet.y > -8);
        for (const bullet of localGame.bullets) {
            const hit = localGame.enemies.findIndex((enemy) => Math.abs(enemy.x - bullet.x) < 17 && Math.abs(enemy.y - bullet.y) < 15);
            if (hit >= 0) {
                localGame.enemies.splice(hit, 1);
                bullet.y = -10;
                setScore(localGame.score + 10);
            }
        }
        localGame.enemies = localGame.enemies.filter((enemy) => {
            if (enemy.y > 272) {
                localGame.lives -= 1;
                if (localGame.lives <= 0) finishArcadeRun();
                return false;
            }
            return true;
        });
    }

    function drawArcadeFrame() {
        const canvas = elements.surface.querySelector('canvas');
        if (!canvas || !currentRoom) return;
        if (!localGame) {
            if (currentRoom.game === 'pong') drawPong(currentRoom.state);
            return;
        }
        if (localGame.game === 'flappy') drawFlappy(canvas);
        else if (localGame.game === 'snake') drawSnake(canvas);
        else drawShooter(canvas);
    }

    function finishArcadeRun() {
        if (!localGame || localGame.over) return;
        localGame.over = true;
        socket.emit('game:arcade-finish');
    }

    function drawFlappy(canvas) {
        const context = configureCanvas(canvas, 420, 280);
        const gradient = context.createLinearGradient(0, 0, 0, 280);
        gradient.addColorStop(0, '#72b7c3');
        gradient.addColorStop(1, '#b8d7b6');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 420, 280);
        context.fillStyle = 'rgba(255,255,255,.48)';
        context.beginPath(); context.arc(326, 50, 20, 0, Math.PI * 2); context.fill();
        for (const pipe of localGame.pipes) {
            context.fillStyle = '#618e58';
            context.fillRect(pipe.x, 0, 42, pipe.gap - 48);
            context.fillRect(pipe.x, pipe.gap + 48, 42, 280 - pipe.gap);
            context.fillStyle = '#82ad68';
            context.fillRect(pipe.x - 4, pipe.gap - 56, 50, 8);
            context.fillRect(pipe.x - 4, pipe.gap + 48, 50, 8);
        }
        context.fillStyle = '#879b55'; context.fillRect(0, 268, 420, 12);
        context.beginPath(); context.arc(75, localGame.y, 13, 0, Math.PI * 2); context.fillStyle = '#f2ce67'; context.fill();
        context.fillStyle = '#403f35'; context.beginPath(); context.arc(80, localGame.y - 3, 2, 0, Math.PI * 2); context.fill();
        context.fillStyle = '#e98c69'; context.fillRect(85, localGame.y + 1, 10, 4);
        drawCanvasLabel(context, `SCORE  ${localGame.score}`, 12, 21, 'left');
        if (localGame.over) drawGameOver(context, 'FLIGHT OVER', 'Tap to try again');
    }

    function drawSnake(canvas) {
        const context = configureCanvas(canvas, 420, 300);
        context.fillStyle = '#202b26'; context.fillRect(0, 0, 420, 300);
        context.strokeStyle = 'rgba(255,255,255,.035)'; context.lineWidth = 1;
        for (let x = 0; x <= 420; x += 20) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 300); context.stroke(); }
        for (let y = 0; y <= 300; y += 20) { context.beginPath(); context.moveTo(0, y); context.lineTo(420, y); context.stroke(); }
        context.fillStyle = '#e8876e'; context.beginPath(); context.arc(localGame.food.x * 20 + 10, localGame.food.y * 20 + 10, 6, 0, Math.PI * 2); context.fill();
        localGame.body.forEach((part, index) => {
            context.fillStyle = index === 0 ? '#d2dda0' : '#8cae76';
            context.beginPath(); context.roundRect(part.x * 20 + 1, part.y * 20 + 1, 18, 18, 5); context.fill();
        });
        drawCanvasLabel(context, `SCORE  ${localGame.score}`, 12, 21, 'left');
        if (localGame.over) drawGameOver(context, 'GAME OVER', 'Press a direction to restart');
    }

    function drawShooter(canvas) {
        const context = configureCanvas(canvas, 420, 280);
        context.fillStyle = '#17212b'; context.fillRect(0, 0, 420, 280);
        for (let index = 0; index < 32; index += 1) {
            const x = (index * 97 + 31) % 420;
            const y = (index * 53 + 17) % 280;
            context.fillStyle = index % 4 === 0 ? 'rgba(239,205,130,.75)' : 'rgba(255,255,255,.58)';
            context.fillRect(x, y, index % 3 === 0 ? 2 : 1, index % 3 === 0 ? 2 : 1);
        }
        context.fillStyle = '#e2c57f';
        for (const bullet of localGame.bullets) context.fillRect(bullet.x - 2, bullet.y, 4, 9);
        context.fillStyle = '#cf8c75';
        for (const enemy of localGame.enemies) {
            context.beginPath(); context.moveTo(enemy.x, enemy.y + 12); context.lineTo(enemy.x - 12, enemy.y - 7); context.lineTo(enemy.x + 12, enemy.y - 7); context.closePath(); context.fill();
        }
        context.fillStyle = '#a9c2a2';
        context.beginPath(); context.moveTo(localGame.ship, 239); context.lineTo(localGame.ship - 13, 263); context.lineTo(localGame.ship, 257); context.lineTo(localGame.ship + 13, 263); context.closePath(); context.fill();
        drawCanvasLabel(context, `SCORE  ${localGame.score}     LIVES  ${localGame.lives}`, 12, 21, 'left');
        if (localGame.over) drawGameOver(context, 'SHIP LOST', 'Press FIRE to restart');
    }

    function drawCanvasLabel(context, text, x, y, align = 'center') {
        context.fillStyle = '#fff'; context.font = '600 11px Arial'; context.textAlign = align; context.fillText(text, x, y);
    }

    function drawGameOver(context, title, detail) {
        context.fillStyle = 'rgba(0,0,0,.54)'; context.fillRect(0, 0, 420, 280);
        context.fillStyle = '#fff'; context.textAlign = 'center'; context.font = '600 21px Arial'; context.fillText(title, 210, 132);
        context.fillStyle = '#d8d8d4'; context.font = '12px Arial'; context.fillText(detail, 210, 155);
    }

    window.addEventListener('keydown', (event) => {
        if (!currentRoom || elements.boardPanel.hidden) return;
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(key)) event.preventDefault();
        pressedKeys.add(key);
        if (currentRoom.game === 'flappy' && ['ArrowUp', ' '].includes(key)) flap(event);
        if (currentRoom.game === 'snake') {
            const directions = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
            if (directions[key]) {
                if (localGame?.over) resetLocalGame();
                setSnakeDirection(directions[key]);
            }
        }
        if (currentRoom.game === 'shooter' && localGame?.over && key === ' ') resetLocalGame();
        if (currentRoom.game === 'pong' && ['ArrowUp', 'ArrowDown', 'w', 's'].includes(key)) pongDirection = ['ArrowUp', 'w'].includes(key) ? -1 : 1;
    });

    window.addEventListener('keyup', (event) => {
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        pressedKeys.delete(key);
        if (currentRoom?.game === 'pong' && ['ArrowUp', 'ArrowDown', 'w', 's'].includes(key)) pongDirection = 0;
    });

    setInterval(() => {
        if (!currentRoom || currentRoom.game !== 'pong' || !pongDirection || performance.now() - lastPongInput < 80) return;
        const index = socket.id === currentRoom.players[1]?.id ? 1 : 0;
        const y = Math.max(.1, Math.min(.9, currentRoom.state.paddles[index] + pongDirection * .04));
        send('game:pong-paddle', { y });
        lastPongInput = performance.now();
    }, 60);

    function resetLocalGame() {
        if (currentRoom?.game === 'pong' || currentRoom?.game === 'tictactoe' || currentRoom?.game === 'rps') return;
        const game = currentRoom?.game;
        if (!game || !['flappy', 'snake', 'shooter'].includes(game)) return;
        resetLocalGameState();
    }

    function resetLocalGameState() {
        const game = currentRoom?.game;
        if (!game) return;
        const canvas = elements.surface.querySelector('canvas');
        if (!canvas) return;
        if (animationId) cancelAnimationFrame(animationId);
        const now = performance.now();
        if (game === 'flappy') localGame = { game, y: 140, velocity: 0, pipes: [{ x: 470, gap: 132 }], lastPipe: now, score: 0, over: false, lastTime: now };
        else if (game === 'snake') localGame = { game, body: [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }], direction: 'right', nextDirection: 'right', food: { x: 15, y: 7 }, score: 0, over: false, accumulator: 0, lastTime: now };
        else localGame = { game, ship: 210, bullets: [], enemies: [], score: 0, lives: 3, over: false, nextWave: now, lastShot: 0, lastTime: now };
        animationId = requestAnimationFrame(stepArcade);
    }

    socket.on('connect', () => {
        elements.connection.classList.remove('offline');
        elements.connectionLabel.textContent = 'Connected';
    });
    socket.on('disconnect', () => {
        elements.connection.classList.add('offline');
        elements.connectionLabel.textContent = 'Reconnecting';
        clearRoom();
        setMessage('Connection lost. Rejoin your room when the server is back.', 'error');
    });
    socket.on('arcade:online', (count) => { elements.online.textContent = String(count); });
    socket.on('room:state', renderRoom);
})();