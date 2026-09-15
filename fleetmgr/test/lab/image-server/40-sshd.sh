#!/bin/sh
# sshd for the SCP pulls. Host keys are made here, not shipped in the image.
set -e
ssh-keygen -A
/usr/sbin/sshd
