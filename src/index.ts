// import {chat} from "./services/openai";

type User = {
    name: string,
    room: string,
    isHost: boolean,
}

type Data = {
    [key: string]: {
        host: any,
        mode: 'local' | 'remote', // remote means that players are not in the same room
        status: 'lobby' | 'welcome' | 'playing' | 'finished',
        players: {
            [key: string]: {
                status: 'online' | 'offline',
                name: string,
                ws: any,
            }
        },
    }
}

const data: Data = {}

const CORS_HEADERS = {
    headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
    },
};

const sendAllData = (room: string) => {
    return JSON.stringify({
        type: 'update',
        data: data[room],
    })
}

const server = Bun.serve<User>({
    hostname: process.env.HOSTNAME,
    async fetch(req, server) {
        const {searchParams, pathname} = new URL(req.url);
        const room = (searchParams.get('room') || '').toLowerCase();
        const name = searchParams.get('name') || '';
        const checkConnection = searchParams.get('check') === 'true';
        const isHost = !name;
        let webSocketData: User = {name, room, isHost}
        console.log('pathname', pathname)

        if (pathname === '/stats') {
            return new Response(JSON.stringify(data, null, 4), {status: 200, ...CORS_HEADERS});
        }
        //
        // if (pathname === '/chat') {
        //     const data = await chat();
        //     return new Response(JSON.stringify(data, null, 4), {status: 200, ...CORS_HEADERS});
        // }

        if (checkConnection && data[room] === undefined) {
            return new Response("signup.roomDoesNotExist", {status: 400, ...CORS_HEADERS});
        }

        if (name) {
            if (data[room] && data[room].players && data[room].players[name] && data[room]?.status === 'lobby') {
                return new Response("signup.usernameIsAlreadyTaken", {status: 400, ...CORS_HEADERS});
            }

            if (checkConnection) {
                return new Response("it's ok", {status: 200, ...CORS_HEADERS});
            }
        }

        if (isHost) {

        }

        const success = server.upgrade(req, {data: webSocketData});

        return success
            ? undefined
            : new Response("WebSocket upgrade error", {status: 400});
    },
    websocket: {
        open(ws) {
            const {isHost, name, room} = ws.data;

            ws.subscribe(room);

            if (data[room] === undefined) {
                data[room] = {
                    status: 'lobby',
                }
            }

            if (isHost) {
                data[room]['host'] = ws
            } else {
                data[room] = {
                    ...data[room],
                    players: {
                        ...data[room]?.players,
                        ...{
                            [name]: {
                                name,
                                ws,
                                status: 'online',
                            }
                        },
                    }
                }
            }

            server.publish(room, sendAllData(room));
        },
        message(ws, message) {
            const {isHost, name, room} = ws.data;
            if (typeof message === "string") {
                if (message === 'ping') {
                    ws.send('pong');
                    return;
                }

                const messageData = message ? JSON.parse(message) : null;
                switch (messageData.type) {
                    case 'requestOnAvatarUpdate':
                        // is sent from connected player to the players and from all players to each other
                        ws.publish(room, message);
                        break
                    case 'welcome':
                    case 'playing':
                    case 'finished':
                        data[room].status = messageData.type
                        server.publish(room, message);
                        break;
                    case 'updateCommonProperties':
                        // is sent from player or host to everyone
                        server.publish(room, message);
                        break;
                    case 'updateGamePropertiesForHost':
                    case 'updateSecretGamePropertiesForHost':
                    case 'updateSpecialGamePropertiesForHost':
                        // is sent from the player to the server
                        data[room]['host'].send(message);
                        break;
                    case 'showNextGameToggle':
                    case 'showFinalScoreToggle':
                    case 'updateGamePropertiesForPlayer':
                        // is sent from the host to the players
                        ws.publish(room, message);
                        break;
                }
            }
        },
        close(ws, code, reason) {
            const {isHost, name, room} = ws.data;

            if (isHost) {
                delete data[room]['host'];
            } else {
                if (data[room].status === 'lobby') {
                    delete data[room].players[name];
                } else {
                    data[room].players[name].status = 'offline';
                }
            }

            const allPlayersOffline = data[room].players ? Object.values(data[room].players).every(player => player.status === 'offline') : true;

            // delete room if all players are offline
            if (allPlayersOffline && !data[room]['host']) {
                delete data[room];
            }

            server.publish(room, sendAllData(room));

            ws.unsubscribe(room);
        },
    },
    // tls: {
    //     key: Bun.file('key.pem'),
    //     cert: Bun.file('cert.csr'),
    // }
});

console.log(`Listening on http://${server.hostname}:${server.port}`);