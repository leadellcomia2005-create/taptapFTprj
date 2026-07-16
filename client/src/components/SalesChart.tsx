import {
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
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface SalesChartProps {
  values: number[];
}

export default function SalesChart({ values }: SalesChartProps) {
  return (
    <Line
      aria-label="Net sales trend for the last seven days"
      data={{
        labels: ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"],
        datasets: [{
          label: "Net sales",
          data: values,
          borderColor: "#d93624",
          backgroundColor: "rgba(217,54,36,.12)",
          fill: true,
          tension: 0.38,
          pointRadius: 4
        }]
      }}
      options={{
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
