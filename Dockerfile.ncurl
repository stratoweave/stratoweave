FROM debian:trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-client sshpass \
 && rm -rf /var/lib/apt/lists/*

COPY out/bin/ncurl /usr/local/bin/ncurl

RUN chmod +x /usr/local/bin/ncurl

ENTRYPOINT ["/usr/local/bin/ncurl"]
CMD ["--help"]
