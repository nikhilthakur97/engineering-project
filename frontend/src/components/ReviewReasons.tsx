export default function ReviewReasons({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;

  return (
    <ul className="mt-2 space-y-1">
      {reasons.map((reason, index) => (
        <li key={index} className="text-xs text-gray-500">
          {reason}
        </li>
      ))}
    </ul>
  );
}
