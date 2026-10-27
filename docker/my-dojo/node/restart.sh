#!/bin/bash

exec pm2-runtime --raw "$APP_DIR/pm2.config.cjs"
