# Learning Curriculum: From Local File to Global Web
## Prerequisite

DO NOT START THIS PHASE UNTIL THE USER HAS VERIFIED THE PIXEL-PERFECT CLONE. This curriculum transitions the learner from understanding how the cloned code works locally to understanding how it lives on the global internet.
## Pedagogical Approach

This guide follows the Socratic and Aristotelian methods. 

    Aristotelian (First Principles): We will break down complex web infrastructure into its fundamental truths. We do not assume "magic." We ask: what is actually happening at the hardware and protocol level?
    Socratic: We will ask questions that lead the learner to deduce the answers themselves.

### Module 1: The Local File (The First Principle)

Concept: What happens when you double-click an index.html file?

    The Truth: The browser reads local bytes via the file:// protocol. There is no server. There is no network. 
    The Question: If there is no server, why does CSS apply? Why might an API call fail here but not on a server?
    Action: Take the cloned frontend. Open it via file://. Observe what breaks.

### Module 2: The Local Host (The Birth of HTTP)

Concept: Moving from file:// to http://localhost:3000.

    The Truth: A "server" is just a long-running process that listens to a port (a virtual door) and speaks HTTP (a text-based protocol). 
    The Question: Why did we need Bun to serve the file? Why can't the browser just pull the file directly when we want to separate frontend and backend?
    Action: Run the Bun frontend server. Explain the HTTP Request/Response cycle happening entirely within your machine's loopback interface (127.0.0.1).

### Module 3: The Encrypted Loop (Self-Signed HTTPS)

Concept: Moving from http:// to https:// locally.

    The Truth: HTTP sends text in plaintext. HTTPS uses TLS (Transport Layer Security) to encrypt it. To do this, the server needs a Certificate and a Private Key. A "Self-Signed" certificate means you are vouching for yourself.
    The Question: Why does the browser show a scary warning for a self-signed certificate, but not for https://google.com? What is a "Certificate Authority"?
    Action: Generate a local key/cert pair using OpenSSL. Configure Bun to serve the frontend over HTTPS. Bypass the browser warning.

### Module 4: The Global Network (IPs and Domains)

Concept: How does a browser find your site when it's not on your local machine?

    The Truth: Every machine on the internet has an IP address (a logical location). A Domain Name is just a mnemonic alias mapped to that IP via DNS (Domain Name System). 
    The Question: If IP addresses are unique, why do we need domains? What happens when you type a URL and press Enter? (Trace the DNS resolution).
    Action: Buy a cheap domain. Understand DNS A-Records and CNAMEs.

### Module 5: The Cloud Machine (Deployment)

Concept: Moving from local Docker to a Cloud VPS (Virtual Private Server).

    The Truth: The cloud is just "someone else's computer." A VPS is a slice of a physical server in a datacenter, running its own OS. 
    The Question: Why can't you host this from your laptop? (Discuss NAT, dynamic IPs, and upload bandwidth). 
    Action: Rent a basic VPS (e.g., AWS EC2, DigitalOcean Droplet). SSH into it.

### Module 6: The Final Production (Putting it all together)

Concept: Serving the Dockerized app to the world securely.

    The Truth: You must run your docker-compose.yml on the VPS. But you need a "Reverse Proxy" (like Nginx or Caddy) to listen on port 443 (HTTPS) and route traffic to your Bun containers on internal ports. You also need a real SSL certificate from Let's Encrypt.
    The Question: Why not just expose Bun directly on port 443? Why use a reverse proxy? (Consider SSL termination and handling multiple sites).
    Action: Install Docker on the VPS. Clone your code. Run the compose file. Install Caddy/Nginx. Point your domain's A-record to the VPS IP. Witness your local clone become a global website.
