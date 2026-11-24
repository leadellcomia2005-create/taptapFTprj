import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

interface SalesChartProps {
  values: number[];
  labels?: string[];
  type?: "line" | "bar";
}

export default function SalesChart({ values, labels = [], type = "line" }: SalesChartProps) {
  const ChartComponent = type === "bar" ? Bar : Line;
  return (
    <ChartComponent
      aria-label={`Net sales ${type} chart for the selected date range`}
      data={{
        labels,
        datasets: [{
          label: "Net sales",
          data: values,
          borderColor: "#d93624",
          backgroundColor: type === "bar" ? "rgba(217,54,36,.72)" : "rgba(217,54,36,.12)",
          borderWidth: type === "bar" ? 1 : 2,
          borderRadius: type === "bar" ? 7 : 0,
          fill: type === "line",
          tension: type === "line" ? 0.38 : 0,
          pointRadius: type === "line" ? 4 : 0
        }]
      }}
      options={{
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { ticks: { callback: (value) => `\u20b1${Number(value).toLocaleString()}` } }
        }
      }}
    />
  );
}
