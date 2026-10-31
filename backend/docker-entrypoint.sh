#!/bin/sh
set -e
# Áp dụng migration (idempotent) rồi khởi động API. Schema engine đã được tải lúc build image.
npx prisma migrate deploy
exec node dist/server.js
