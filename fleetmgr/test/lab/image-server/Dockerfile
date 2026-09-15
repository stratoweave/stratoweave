# The lab's image server: nginx and sshd. The software images are not built
# in; the lab bind-mounts them at /usr/share/nginx/html/images. root/admin,
# lab only.
FROM nginx:alpine

# IOS XE's xcopy runs `scp -pf <path>` on this side over SSH, so the client
# package is needed too. Without `scp` the device reports install-op-succ
# with a zero-byte file on bootflash.
RUN apk add --no-cache openssh-server openssh-client \
 && sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/; s/^#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config \
 && echo 'root:admin' | chpasswd

# nginx's entrypoint runs the executable scripts in this directory first.
COPY 40-sshd.sh /docker-entrypoint.d/40-sshd.sh

EXPOSE 22 80
