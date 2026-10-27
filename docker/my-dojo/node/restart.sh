#!/bin/bash

exec node "$APP_DIR/dist/lib/coordination/supervisor.js" "$APP_DIR/pm2.config.cjs"
