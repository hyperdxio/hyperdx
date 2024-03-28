# syntax=docker/dockerfile:1

# specify the base image to  be used for the application, alpine or ubuntu
FROM golang:1.21-alpine

# create a working directory inside the image
WORKDIR /app

# copy Go modules and dependencies to image
COPY ./packages/go-parser/go.mod ./packages/go-parser/go.sum ./

# download Go modules and dependencies
RUN go mod download

# copy directory files i.e all files ending with .go
COPY ./packages/go-parser ./

# compile application
RUN go build -o /go-parser

# tells Docker that the container listens on specified network ports at runtime
EXPOSE 7777

# command to be used to execute when the image is used to start a container
CMD [ "/go-parser" ]
