#!/bin/sh
case " ${RENEWED_DOMAINS:-} " in
  *" tp.kennyy.tech "*)
    /bin/systemctl reload nginx
    ;;
esac
