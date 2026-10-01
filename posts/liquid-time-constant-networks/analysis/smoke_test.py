"""Pruebas de humo de la implementación manual de LTC.

Verifican que el código funciona y que respeta el álgebra de la Ec. (3).
NO reproducen los resultados experimentales del paper.

Uso:  python smoke_test.py
"""

import torch
from torch import nn

from ltc_manual import LTCCell, LTCNetwork

torch.manual_seed(0)

BATCH, SEQ_LEN, INPUT_SIZE, HIDDEN_SIZE, OUTPUT_SIZE = 16, 32, 7, 32, 5


def test_shapes_and_finite_outputs():
    model = LTCNetwork(INPUT_SIZE, HIDDEN_SIZE, OUTPUT_SIZE)
    sequence = torch.randn(BATCH, SEQ_LEN, INPUT_SIZE)
    outputs, last_state = model(sequence)
    assert outputs.shape == (BATCH, SEQ_LEN, OUTPUT_SIZE)
    assert last_state.shape == (BATCH, HIDDEN_SIZE)
    assert torch.isfinite(outputs).all()

    single, _ = model(sequence[:1])  # lote de tamaño 1
    assert single.shape == (1, SEQ_LEN, OUTPUT_SIZE)
    print(f"[ok] formas: salidas {tuple(outputs.shape)}, estado final {tuple(last_state.shape)}; valores finitos")


def test_gradients_exist():
    model = LTCNetwork(INPUT_SIZE, HIDDEN_SIZE, OUTPUT_SIZE)
    outputs, _ = model(torch.randn(BATCH, SEQ_LEN, INPUT_SIZE))
    outputs.sum().backward()
    for name, parameter in model.named_parameters():
        assert parameter.grad is not None, name
        assert torch.isfinite(parameter.grad).all(), name
        assert parameter.grad.abs().sum() > 0, name
    names = ", ".join(name for name, _ in model.named_parameters())
    print(f"[ok] gradientes finitos y no nulos en: {names}")


def test_fused_step_algebra():
    """Con f = 0 la Ec. (3) debe reducirse a x / (1 + Δt/τ): Euler implícito de dx/dt = -x/τ."""
    cell = LTCCell(INPUT_SIZE, HIDDEN_SIZE)
    cell.f = lambda x, input_t: torch.zeros_like(x)
    x = torch.randn(BATCH, HIDDEN_SIZE)
    expected = x / (1.0 + cell.dt / cell.tau)
    assert torch.allclose(cell.fused_step(x, torch.zeros(BATCH, INPUT_SIZE)), expected)

    # Con f arbitraria, x_next debe cumplir la ecuación semi-implícita de la que sale la Ec. (3):
    # x_next = x + Δt * ( -(1/τ + f) * x_next + f * A )
    cell = LTCCell(INPUT_SIZE, HIDDEN_SIZE)
    input_t = torch.randn(BATCH, INPUT_SIZE)
    f_val = cell.f(x, input_t)
    x_next = cell.fused_step(x, input_t)
    residual = x_next - (x + cell.dt * (-(1.0 / cell.tau + f_val) * x_next + f_val * cell.A))
    assert residual.abs().max() < 1e-5
    print(f"[ok] álgebra de la Ec. (3): residuo máximo de la ecuación semi-implícita = {residual.abs().max().item():.1e}")


def test_bounds_with_sigmoid():
    """Con f en (0, 1), el estado debe quedar entre min(0, A_i) y max(0, A_i) (Teorema 2)
    y τ_sys entre τ/(1+τ) y τ (Teorema 1 con W_i = 1), incluso con entradas enormes."""
    cell = LTCCell(INPUT_SIZE, HIDDEN_SIZE, activation="sigmoid")
    lower = torch.minimum(torch.zeros_like(cell.A), cell.A)
    upper = torch.maximum(torch.zeros_like(cell.A), cell.A)
    x = torch.zeros(BATCH, HIDDEN_SIZE)
    with torch.no_grad():
        for step in range(200):
            input_t = 1e6 * torch.randn(BATCH, INPUT_SIZE)
            tau_sys = cell.tau_sys(x, input_t)
            assert (tau_sys <= cell.tau + 1e-6).all() and (tau_sys >= cell.tau / (1 + cell.tau) - 1e-6).all()
            x = cell(input_t, x)
            assert (x >= lower - 1e-6).all() and (x <= upper + 1e-6).all(), step
    print(f"[ok] cotas con sigmoide y entradas ~1e6: max|x| = {x.abs().max().item():.3f} <= max|A| = {cell.A.abs().max().item():.3f}")


def demo_explicit_vs_fused():
    """Decaimiento lineal dx/dt = -x/τ con Δt/τ > 2: Euler explícito diverge, el paso fusionado no."""
    tau, dt, steps = 0.05, 1.0 / 6.0, 12
    x_explicit = x_fused = 1.0
    for _ in range(steps):
        x_explicit = x_explicit + dt * (-x_explicit / tau)
        x_fused = x_fused / (1.0 + dt / tau)
    print(f"[demo] τ = {tau}, Δt = {dt:.4f} (Δt/τ = {dt / tau:.2f}), {steps} pasos, x(0) = 1")
    print(f"       Euler explícito: x = {x_explicit:.3e}   |   paso fusionado: x = {x_fused:.3e}   |   exacta: {torch.exp(torch.tensor(-steps * dt / tau)).item():.3e}")


def demo_training_loop():
    """Algorithm 2 con herramientas actuales sobre una tarea de juguete (no es un experimento del paper)."""
    torch.manual_seed(0)
    time = torch.linspace(0, 8 * torch.pi, 257)
    inputs = torch.stack([torch.sin(time[:-1]), torch.cos(time[:-1])], dim=-1).reshape(8, 32, 2)  # (8, 32, 2)
    targets = torch.sin(2 * time[1:]).reshape(8, 32, 1)                                           # (8, 32, 1)

    model = LTCNetwork(input_size=2, hidden_size=32, output_size=1)
    criterion = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=0.01, betas=(0.9, 0.999), eps=1e-8)

    losses = []
    for step in range(300):
        optimizer.zero_grad()
        outputs, _ = model(inputs)          # forward: desenrolla T × L FusedSteps
        loss = criterion(outputs, targets)  # L_total
        loss.backward()                     # BPTT a través del grafo desenrollado
        optimizer.step()                    # θ ← θ - α ∇L (aquí con Adam)
        losses.append(loss.item())
    assert losses[-1] < losses[0]
    print(f"[demo] entrenamiento de juguete: MSE inicial = {losses[0]:.3f}, tras 300 pasos = {losses[-1]:.1e} (datos de entrenamiento)")


if __name__ == "__main__":
    print(f"torch {torch.__version__}")
    test_shapes_and_finite_outputs()
    test_gradients_exist()
    test_fused_step_algebra()
    test_bounds_with_sigmoid()
    demo_explicit_vs_fused()
    demo_training_loop()
    n_params = sum(p.numel() for p in LTCNetwork(INPUT_SIZE, HIDDEN_SIZE, OUTPUT_SIZE).cell.parameters())
    print(f"parámetros de la celda (M={INPUT_SIZE}, N={HIDDEN_SIZE}): {n_params}")
