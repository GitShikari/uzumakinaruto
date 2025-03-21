FROM node:18

# Install FFmpeg (required for transcoding)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json (if available) to install dependencies first
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port your app runs on
EXPOSE 3000

# Start the application
CMD ["node", "app.js"]
