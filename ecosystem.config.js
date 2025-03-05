module.exports = {
  apps: [{
    name: 'tic-tac-toe',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '460M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    node_args: '--optimize-for-size --max-old-space-size=460'
  }]
}; 
