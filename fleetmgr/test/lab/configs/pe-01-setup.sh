#!/bin/sh
# Make the VRF and dot1Q devices configs/pe-01.conf names; FRR applies the
# held config once they exist. Run from exec in lab.clab.yml.
set -e
ip link add vrf-a type vrf table 100
ip link add vrf-b type vrf table 200
ip link set vrf-a up
ip link set vrf-b up
for i in 2 3 4; do
    ip link set eth$i up
    ip link add link eth$i name eth$i.100 type vlan id 100
    ip link set eth$i.100 up
done
ip link set eth2.100 master vrf-a
ip link set eth3.100 master vrf-a
ip link set eth4.100 master vrf-b
