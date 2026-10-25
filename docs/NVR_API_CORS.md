# Separate NVR API CORS

When the camstack web app runs on a different origin (e.g. `http://localhost:8081`) than Separate NVR (e.g. `https://nvr.example.com`), the browser blocks API requests due to CORS.

**Solution:** Add CORS headers in the reverse proxy in front of Separate NVR (nginx, Caddy, Traefik, etc.).

## Nginx

Add to your Separate NVR `location /` block:

```nginx
# Handle preflight
if ($request_method = 'OPTIONS') {
    add_header 'Access-Control-Allow-Origin' '$http_origin' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Authorization, Content-Type' always;
    add_header 'Access-Control-Max-Age' 86400;
    return 204;
}

add_header 'Access-Control-Allow-Origin' '$http_origin' always;
add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
add_header 'Access-Control-Allow-Headers' 'Authorization, Content-Type' always;
add_header 'Access-Control-Allow-Credentials' 'true' always;
```

For development only (allow any origin):

```nginx
add_header 'Access-Control-Allow-Origin' '*' always;
add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
add_header 'Access-Control-Allow-Headers' 'Authorization, Content-Type' always;
```

## Caddy

Add to your Separate NVR server block:

```caddy
header Access-Control-Allow-Origin *
header Access-Control-Allow-Methods "GET, POST, OPTIONS"
header Access-Control-Allow-Headers "Authorization, Content-Type"
```

For specific origins (more secure):

```caddy
@options method OPTIONS
respond @options 204 {
    header Access-Control-Allow-Origin "http://localhost:8081"
    header Access-Control-Allow-Methods "GET, POST, OPTIONS"
    header Access-Control-Allow-Headers "Authorization, Content-Type"
}
header Access-Control-Allow-Origin "http://localhost:8081"
header Access-Control-Allow-Methods "GET, POST, OPTIONS"
header Access-Control-Allow-Headers "Authorization, Content-Type"
header Access-Control-Allow-Credentials "true"
```

## Traefik

Add middleware labels to your Separate NVR service:

```yaml
labels:
  - "traefik.http.middlewares.separate-nvr-cors.headers.accesscontrolallowmethods=GET,POST,OPTIONS"
  - "traefik.http.middlewares.separate-nvr-cors.headers.accesscontrolallowheaders=Authorization,Content-Type"
  - "traefik.http.middlewares.separate-nvr-cors.headers.accesscontrolalloworiginlist=http://localhost:8081"
  - "traefik.http.middlewares.separate-nvr-cors.headers.accesscontrolallowcredentials=true"
  - "traefik.http.routers.separate-nvr.middlewares=separate-nvr-cors"
```

## After changes

Reload your reverse proxy (e.g. `nginx -s reload` or restart Caddy/Traefik), then retry adding cameras in camstack.
