export default function MenuPhoto({ product, className = "", priority = false }) {
  const classes = ["menu-photo", className].filter(Boolean).join(" ");
  if (product?.image) {
    return (
      <div className={classes}>
        <img src={product.image} alt="" loading={priority ? "eager" : "lazy"} decoding="async" />
      </div>
    );
  }

  return (
    <div
      className={`${classes} menu-photo-placeholder`.trim()}
      style={{ backgroundPosition: product?.imagePosition }}
    />
  );
}
