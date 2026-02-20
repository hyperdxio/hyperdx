#!/bin/bash

# Set anonymous auth mode (auth enabled but auto-login with real MongoDB user)
export IS_LOCAL_APP_MODE="REQUIRED_AUTH"
export HDX_AUTH_ANONYMOUS_ENABLED="true"
export NEXT_PUBLIC_HDX_AUTH_ANONYMOUS_ENABLED="true"

# Source the common entry script
source "/etc/local/entry.base.sh"
