import unittest
from configure_frontend_cache import INCLUDE, configure


class FrontendCacheConfigTests(unittest.TestCase):
    def test_preserves_custom_config_and_is_idempotent(self):
        original = '''server {
    listen 443 ssl;
    ssl_certificate /etc/ssl/cert.pem;
    location / {
        # A comment containing } should not end the block.
        add_header Example "brace }";
        try_files $uri $uri/ /index.html;
    }
    include /etc/nginx/snippets/wss-game.conf;
}
'''
        result = configure(original)
        self.assertEqual(result.count(INCLUDE), 1)
        self.assertIn('ssl_certificate /etc/ssl/cert.pem;', result)
        self.assertIn('include /etc/nginx/snippets/wss-game.conf;', result)
        self.assertEqual(configure(result), result)

    def test_updates_each_server_root_but_no_asset_location(self):
        result = configure('''server {
    location /assets/ { try_files $uri =404; }
    location / { try_files $uri /index.html; }
}
server {
    location ^~ / { try_files $uri /index.html; }
}
''')
        self.assertEqual(result.count(INCLUDE), 2)
        self.assertIn('location /assets/ { try_files $uri =404; }', result)

    def test_rejects_unknown_or_unclosed_configuration(self):
        for text in ['server { location /api/ {} }', 'location / {']:
            with self.assertRaises(ValueError):
                configure(text)

    def test_commented_include_does_not_disable_installation(self):
        result = configure('location / {\n    # ' + INCLUDE + '\n}\n')
        self.assertEqual(result.count(INCLUDE), 2)


if __name__ == '__main__':
    unittest.main()
