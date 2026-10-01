"""Implementación manual y transparente de una red LTC con el Fused ODE Solver.

Sigue la Ec. (3) y el Algorithm 1 de Hasani et al., "Liquid Time-constant
Networks" (AAAI 2021). El objetivo es pedagógico: cada línea se corresponde
con un símbolo del paper. No es la implementación oficial de los autores.
"""

import torch
from torch import nn


class LTCCell(nn.Module):
    """Una celda LTC: avanza el estado oculto un paso de entrada (L FusedSteps)."""

    def __init__(self, input_size, hidden_size, unfolds=6, dt=1.0 / 6.0, activation="tanh"):
        super().__init__()
        self.input_size = input_size    # M: dimensión de la entrada I(t)
        self.hidden_size = hidden_size  # N: número de neuronas
        self.unfolds = unfolds          # L: pasos del solver por cada entrada
        self.dt = dt                    # Δt: tamaño del paso del solver
        self.activation = {"tanh": torch.tanh, "sigmoid": torch.sigmoid}[activation]

        bound = hidden_size ** -0.5
        # θ = {γ, γ_r, μ, τ} y el vector A, como en el Algorithm 1
        self.input_weights = nn.Parameter(torch.empty(input_size, hidden_size).uniform_(-bound, bound))       # γ   (M × N)
        self.recurrent_weights = nn.Parameter(torch.empty(hidden_size, hidden_size).uniform_(-bound, bound))  # γ_r (N × N)
        self.bias = nn.Parameter(torch.zeros(hidden_size))                                                    # μ   (N)
        self.log_tau = nn.Parameter(torch.zeros(hidden_size))                                                 # τ = exp(log_tau) > 0
        self.A = nn.Parameter(torch.empty(hidden_size).uniform_(-1.0, 1.0))                                   # A   (N)

    @property
    def tau(self):
        return torch.exp(self.log_tau)

    def f(self, x, input_t):
        """f(x(t), I(t), t, θ) = activación(γ_r x + γ I + μ).   Salida: (batch, N)."""
        return self.activation(x @ self.recurrent_weights + input_t @ self.input_weights + self.bias)

    def fused_step(self, x, input_t):
        """Ec. (3): un paso del Fused ODE Solver.   x: (batch, N), input_t: (batch, M)."""
        f_val = self.f(x, input_t)
        numerator = x + self.dt * f_val * self.A
        denominator = 1.0 + self.dt * (1.0 / self.tau + f_val)
        x_next = numerator / denominator
        return x_next

    def tau_sys(self, x, input_t):
        """Constante de tiempo efectiva: τ_sys = τ / (1 + τ f)."""
        return self.tau / (1.0 + self.tau * self.f(x, input_t))

    def forward(self, input_t, x):
        for _ in range(self.unfolds):  # bucle "for i = 1 ... L" del Algorithm 1
            x = self.fused_step(x, input_t)
        return x


class LTCNetwork(nn.Module):
    """Celda LTC desenrollada en el tiempo + capa lineal de salida (Algorithm 2)."""

    def __init__(self, input_size, hidden_size, output_size, unfolds=6, dt=1.0 / 6.0, activation="tanh"):
        super().__init__()
        self.cell = LTCCell(input_size, hidden_size, unfolds, dt, activation)
        self.readout = nn.Linear(hidden_size, output_size)  # W_out, b_out

    def forward(self, sequence, initial_state=None):
        # sequence: (batch, T, M)
        batch_size, seq_len, _ = sequence.shape
        x = initial_state
        if x is None:
            x = sequence.new_zeros(batch_size, self.cell.hidden_size)  # x(0)

        outputs = []
        for t in range(seq_len):               # bucle "for j = 1 ... T" del Algorithm 2
            input_t = sequence[:, t, :]        # I(t): (batch, M)
            x = self.cell(input_t, x)          # x(t + Δt): (batch, N)
            outputs.append(self.readout(x))    # ŷ(t) = W_out x + b_out
        return torch.stack(outputs, dim=1), x  # (batch, T, salida), (batch, N)
