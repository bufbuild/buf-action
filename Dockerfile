FROM node:22

RUN apt update && apt install -y git

COPY dist/index.js /index.js
COPY entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
