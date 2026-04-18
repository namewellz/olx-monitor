# Builder Stage
FROM node:20 AS builder
WORKDIR /usr/app
COPY ./src ./
RUN npm install --only=production

# Final Stage
FROM node:20
ARG NODE_ENV
WORKDIR /usr/app
COPY --from=builder /usr/app/ ./
RUN mkdir -p /usr/data
EXPOSE 3000
CMD [ "npm", "start" ]