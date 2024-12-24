# Setup SSL nginx reverse proxy

1. Install mkcert [mkcert](https://github.com/FiloSottile/mkcert)
2. Exec `mkcert mydomain.local` and `mkcert -install`
3. Make sure the pem files are used in the nginx.conf file
4. Update HYPERDX_APP_URL to https://mydomain.local in the .env file
5. Update HYPERDX_APP_PORT to 443 (same as the nginx server port) in the .env file
6. Add the following to the /etc/hosts file
```
127.0.0.1 mydomain.local
```
7. Comment out ports mapping in the docker-compose.yml file for `app` service (so that the app is not exposed to the host)
8. Enable nginx service in the docker-compose.yml file
9. Run `docker-compose up -d`
10. Open https://mydomain.local in the browser
