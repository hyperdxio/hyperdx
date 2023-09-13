# Dockerfile
# Uses multi-stage builds requiring Docker 17.05 or higher
# See https://docs.docker.com/develop/develop-images/multistage-build/

# Creating a python base with shared environment variables
FROM python:3.11.3-slim AS python-base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=off \
    PIP_DISABLE_PIP_VERSION_CHECK=on \
    PIP_DEFAULT_TIMEOUT=100 \
    POETRY_HOME="/opt/poetry" \
    POETRY_VIRTUALENVS_IN_PROJECT=true \
    POETRY_NO_INTERACTION=1 \
    PYSETUP_PATH="/opt/pysetup" \
    VENV_PATH="/opt/pysetup/.venv"

ENV PATH="$POETRY_HOME/bin:$VENV_PATH/bin:$PATH"


# builder-base is used to build dependencies
FROM python-base as builder-base
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        curl \
        build-essential
# Install Poetry - respects $POETRY_VERSION & $POETRY_HOME
ENV POETRY_VERSION=1.5.1
RUN curl -sSL https://install.python-poetry.org | python -

# We copy our Python requirements here to cache them
# and install only runtime deps using poetry
WORKDIR $PYSETUP_PATH
COPY ./packages/miner/poetry.lock ./packages/miner/pyproject.toml ./
RUN poetry install --no-dev  # respects 

# Reads through the list of packages installed in your active site-packages folder
# and installs the corresponding instrumentation libraries for these packages
RUN opentelemetry-bootstrap --action=install

# 'development' stage installs all dev deps and can be used to develop code.
# For example using docker-compose to mount local volume under /app
FROM python-base as dev
ENV FASTAPI_ENV=development

# Copying poetry and venv into image
COPY --from=builder-base $POETRY_HOME $POETRY_HOME
COPY --from=builder-base $PYSETUP_PATH $PYSETUP_PATH

# Copying in our entrypoint
COPY ./packages/miner/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# venv already has runtime deps installed we get a quicker install
WORKDIR $PYSETUP_PATH
RUN poetry install


WORKDIR /app

EXPOSE 5123
ENTRYPOINT /docker-entrypoint.sh $0 $@
CMD ["opentelemetry-instrument", "uvicorn", "--reload", "--host=0.0.0.0", "--port=5123", "src.main:app"]


# 'lint' stage runs black and isort
# running in check mode means build will fail if any linting errors occur
# FROM development AS lint
# RUN black --config ./pyproject.toml --check app tests
# RUN isort --settings-path ./pyproject.toml --recursive --check-only
# CMD ["tail", "-f", "/dev/null"]


# 'test' stage runs our unit tests with pytest and
# coverage.  Build will fail if test coverage is under 95%
# FROM development AS test
# RUN coverage run --rcfile ./pyproject.toml -m pytest ./tests
# RUN coverage report --fail-under 95


# 'production' stage uses the clean 'python-base' stage and copyies
# in only our runtime deps that were installed in the 'builder-base'
FROM python-base as prod
ENV FASTAPI_ENV=production
ENV PORT=5123

EXPOSE 5123

COPY --from=builder-base $VENV_PATH $VENV_PATH
COPY ./packages/miner/gunicorn_conf.py /gunicorn_conf.py

COPY ./packages/miner/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

COPY ./packages/miner/src /app/src
WORKDIR /app

ENTRYPOINT /docker-entrypoint.sh $0 $@
CMD [ "gunicorn", "--worker-class uvicorn.workers.UvicornWorker", "--config /gunicorn_conf.py", "src.main:app"]
