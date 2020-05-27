#!/bin/sh

jq ".content_security_policy = \"script-src 'self' 'unsafe-eval'; object-src 'self'\"" manifest.json | sponge manifest.json
jq ".permissions = [ \"tabs\", \"storage\", \"<all_urls>\"]" manifest.json | sponge manifest.json
