#!/bin/bash
set -e

echo "Checking DNS..."
IP=$(dig +short bi.kimonogroup.ro @8.8.8.8)
if [ "$IP" != "91.200.121.88" ]; then
  echo "DNS not propagated yet. bi.kimonogroup.ro resolves to $IP"
  exit 1
fi

echo "Getting SSL certificate..."
systemctl stop httpd
certbot certonly --standalone -d bi.kimonogroup.ro --non-interactive --agree-tos -m office@kimonogroup.ro
systemctl start httpd

echo "Enabling HTTPS in Apache config..."
cat > /etc/apache2/conf.d/bi.kimonogroup.ro.conf << 'CONFEOF'
<VirtualHost 91.200.121.88:80>
    ServerName bi.kimonogroup.ro
    Redirect permanent / https://bi.kimonogroup.ro/
</VirtualHost>

<VirtualHost 91.200.121.88:443>
    ServerName bi.kimonogroup.ro
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/bi.kimonogroup.ro/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/bi.kimonogroup.ro/privkey.pem
    
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:3100/
    ProxyPassReverse / http://127.0.0.1:3100/
    RequestHeader set X-Forwarded-Proto "https"
</VirtualHost>
CONFEOF

systemctl reload httpd
echo "SSL enabled! https://bi.kimonogroup.ro is now live."

# Add certbot renewal to crontab
(crontab -l 2>/dev/null; echo '0 3 * * 1  certbot renew --quiet --pre-hook "systemctl stop httpd" --post-hook "systemctl start httpd"') | crontab -
echo "Certbot auto-renewal added to crontab."
