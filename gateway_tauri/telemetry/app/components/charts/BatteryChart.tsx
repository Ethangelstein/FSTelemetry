"use client"

import dynamic from "next/dynamic"
import {ApexOptions} from "apexcharts"

// Dynamically import ApexCharts to prevent SSR issues
const Chart = dynamic(() => import("react-apexcharts"), {ssr: false})

interface BatteryChartProps {
  data: {
    timestamp: number
    voltage_mv: number
    current_ma: number
  }[]
}

export default function BatteryChart({data}: BatteryChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-black border-2 border-green-400 p-4 font-mono text-center text-gray-500 h-48 flex items-center justify-center">
        NO BATTERY HISTORY
      </div>
    )
  }

  const series = [
    {
      name: "Voltage",
      data: data.map(p => [p.timestamp, p.voltage_mv / 1000])
    },
    {
      name: "Current",
      data: data.map(p => [p.timestamp, p.current_ma / 1000])
    }
  ]

  const options: ApexOptions = {
    chart: {
      height: "100%",
      type: "line",
      background: "transparent",
      toolbar: {
        show: false
      },
      animations: {
        enabled: true,
        dynamicAnimation: {
          speed: 1000
        }
      }
    },
    colors: ["#4ade80", "#22c55e"],
    dataLabels: {
      enabled: false
    },
    stroke: {
      curve: "smooth",
      width: 2
    },
    grid: {
      borderColor: "#374151",
      strokeDashArray: 3
    },
    legend: {
      show: true,
      position: "top",
      horizontalAlign: "right",
      labels: {
        colors: "#9CA3AF"
      },
      markers: {
        size: 12,
        strokeWidth: 12
      }
    },
    tooltip: {
      enabled: true,
      theme: "dark",
      x: {
        format: "HH:mm:ss"
      },
      y: [
        {
          title: {
            formatter: seriesName => `${seriesName}:`
          },
          formatter: val => `${val.toFixed(2)} V`
        },
        {
          title: {
            formatter: seriesName => `${seriesName}:`
          },
          formatter: val => `${val.toFixed(2)} A`
        }
      ]
    },
    xaxis: {
      type: "datetime",
      labels: {
        style: {
          colors: "#9CA3AF",
          fontSize: "10px"
        },
        format: "HH:mm:ss"
      },
      axisBorder: {
        show: false
      },
      axisTicks: {
        show: false
      }
    },
    yaxis: [
      {
        seriesName: "Voltage",
        title: {
          text: "Voltage (V)",
          style: {
            color: "#4ade80",
            fontSize: "12px",
            fontWeight: "normal"
          }
        },
        labels: {
          style: {
            colors: "#4ade80",
            fontSize: "12px"
          },
          formatter: val => val.toFixed(1)
        }
      },
      {
        seriesName: "Current",
        opposite: true,
        title: {
          text: "Current (A)",
          style: {
            color: "#22c55e",
            fontSize: "12px",
            fontWeight: "normal"
          }
        },
        labels: {
          style: {
            colors: "#22c55e",
            fontSize: "12px"
          },
          formatter: val => val.toFixed(1)
        }
      }
    ]
  }

  return (
    <div className="bg-black border-2 border-green-400 p-4 font-mono h-48 w-full">
      <Chart options={options} series={series} type="line" height="100%" />
    </div>
  )
}
