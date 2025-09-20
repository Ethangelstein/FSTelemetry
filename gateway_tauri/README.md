# F1-Style Telemetry Dashboard

A real-time telemetry dashboard built with Next.js and Socket.IO for F1-style racing data visualization.

## Features

- 🏎️ **Real-time telemetry data** via Socket.IO
- 📊 **Live dashboard** with speed, RPM, G-forces, and battery monitoring
- 🗺️ **Track visualization** with GPS positioning
- 📈 **Performance charts** for lap times and battery usage
- 🔄 **Automatic reconnection** with fallback to simulation
- 📱 **Responsive design** for mobile and desktop

## Getting Started

### Prerequisites

- Node.js 18+
- npm, yarn, or pnpm

### Installation

1. **Install dependencies:**

```bash
npm install
# or
yarn install
```

2. **Start the development server:**

```bash
npm run dev
# or
yarn dev
```

3. **Open the dashboard:**
   Navigate to [http://localhost:3000](http://localhost:3000)

### Testing with Real Data

**Start example Socket.IO server:**

```bash
npm run example-server
# or
yarn example-server
```

**Test Socket.IO connection:**

```bash
npm run test-socketio
# or
yarn test-socketio
```

**Test HTTP API (legacy):**

```bash
npm run test-http
# or
yarn test-http
```

## Architecture

- **Frontend**: Next.js 15 with React 19
- **Real-time**: Socket.IO for WebSocket communication
- **Charts**: ApexCharts for data visualization
- **Styling**: Tailwind CSS
- **Data**: LocalStorage + IndexedDB for persistence

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
