# JWT Authentication and Sitemap-less Operation

We have a need to scan a few websites which require authentication and have no sitemap.

## Authentication
For one of these sites, we have a simple auth system that sets a JWT token in a cookie. All url requests using that token will be authenticated and proceed normally. 

The JWT token and cookie name can come from outside the tool, included as env vars and options.
_We need a solution to include the JWT cookie in our url requests._

## Sitemap-less Operation
For sites that do not have sitemaps, we need a way to alternately include a fixed set of urls to scan instead of a sitemap.
