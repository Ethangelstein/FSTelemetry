import {lazy, Suspense} from "react"
import {ApexOptions} from "apexcharts"

const Chart = lazy(() => import("react-apexcharts"))

interface LapTimeChartProps {
  data: {lap: number; time: number}[]
}

const formatLapTime = (ms: number) => {
  if (ms === 0) return "0:00.00"
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const millis = Math.floor((ms % 1000) / 10)
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${millis.toString().padStart(2, "0")}`
}

export default function LapTimeChart({data}: LapTimeChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-black border-2 border-orange-400 p-4 font-mono text-center text-gray-500 h-48 flex items-center justify-center">
        NO LAP DATA
      </div>
    )
  }

  const bestTime = Math.min(...data.map(d => d.time))

  const series = [
    {
      name: "Lap Time",
      data: data.map(d => d.time)
    }
  ]

  const options: ApexOptions = {
    chart: {
      type: "bar",
      height: "100%",
      background: "transparent",
      toolbar: {
        show: false
      }
    },
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: "60%"
      }
    },
    colors: [
      function ({
        seriesIndex,
        w
      }: {
        seriesIndex: number
        w: {config: {series: Array<{data: number[]}>}; dataPointIndex: number}
      }) {
        if (w.config.series[seriesIndex].data[w.dataPointIndex] === bestTime) {
          return "#ff8800"
        } else {
          return "#f97316"
        }
      }
    ],
    dataLabels: {
      enabled: false
    },
    grid: {
      borderColor: "#374151",
      strokeDashArray: 3
    },
    tooltip: {
      theme: "dark",
      y: {
        formatter: val => formatLapTime(val)
      }
    },
    xaxis: {
      categories: data.map(d => `Lap ${d.lap}`),
      labels: {
        style: {
          colors: "#f97316",
          fontSize: "12px"
        }
      },
      axisBorder: {
        show: false
      },
      axisTicks: {
        show: false
      }
    },
    yaxis: {
      labels: {
        style: {
          colors: "#f97316",
          fontSize: "12px"
        },
        formatter: val => formatLapTime(val).split(".")[0]
      }
    }
  }

  return (
    <div className="bg-black border-2 border-orange-400 p-4 font-mono h-48 w-full">
      <Suspense
        fallback={<div className="flex items-center justify-center h-full text-gray-500">Loading chart...</div>}
      >
        <Chart options={options} series={series} type="bar" height="100%" />
      </Suspense>
    </div>
  )
}
